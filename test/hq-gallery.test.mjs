import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDatabase} from './d1-adapter.mjs';
import {createApp,createAuthConfig} from '../server/worker.js';

const read=async file=>JSON.parse(await readFile(new URL('../'+file,import.meta.url),'utf8'));
const app=createApp(await read('content/recipes.json'),await read('content/photos.json'),await read('content/shopping.json'));
const origin='https://recipes.njmurray.com',site='https://photography.njmurray.com';
const auth=JSON.stringify(await createAuthConfig('hq-test-owner','hq-test-passphrase'));
const photo=new Uint8Array(await readFile(new URL('../public/images/mackerel-nicoise-salad.webp',import.meta.url)));
const alternate=new Uint8Array(await readFile(new URL('../public/images/halloumi-breakfast-skillet.webp',import.meta.url)));
const metadata={file:'Original.jpg',width:389,height:306,capturedAt:'2026-01-02T12:30:00Z',title:'Original title',alt:'Original description'};
const fakeToken='test-only-hq-storage-token';
const sha=value=>String(value).padStart(40,'a');
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

function fixture(t){
  const db=createDatabase();t.after(()=>db.close());
  const env={RECIPES_DB:db,ADMIN_AUTH:auth,ADMIN_ORIGIN:origin,PHOTO_GITHUB_TOKEN:fakeToken,ASSETS:{fetch:()=>new Response('asset')}};
  const request=(path,{method='GET',source=site,cookie,body,headers={}}={})=>{
    const isJson=body&&Object.getPrototypeOf(body)===Object.prototype;
    return app.fetch(new Request(origin+path,{method,headers:{...(source?{Origin:source}:{}),...(cookie?{Cookie:cookie}:{}),...(isJson?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:isJson?JSON.stringify(body):body}:{})}),env,{});
  };
  const login=async()=>{const r=await request('/api/shared/login',{method:'POST',body:{username:'hq-test-owner',password:'hq-test-passphrase'}});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
  const gallery=async()=>{const r=await request('/api/shared/gallery',{source:null});assert.equal(r.status,200);return r.json();};
  return {db,env,request,login,gallery};
}
function multipart({meta=metadata,small=photo,large=photo,high=photo,highType='image/webp'}={}){
  const form=new FormData();form.set('metadata',typeof meta==='string'?meta:JSON.stringify(meta));
  form.set('small',new Blob([small],{type:'image/webp'}),'960.webp');
  form.set('large',new Blob([large],{type:'image/webp'}),'1920.webp');
  if(high!==null)form.set('high',new Blob([high],{type:highType}),'3840.webp');
  return form;
}
function chunk(bytes,type,payload){
  const data=typeof payload==='string'?new TextEncoder().encode(payload):payload;
  const result=new Uint8Array(bytes.length+8+data.length+(data.length%2));result.set(bytes);
  const offset=bytes.length;result.set(new TextEncoder().encode(type),offset);
  const view=new DataView(result.buffer);view.setUint32(offset+4,data.length,true);result.set(data,offset+8);view.setUint32(4,result.length-8,true);return result;
}
function github(t,{beforeRefUpdate}={}){
  const calls=[];let head=sha(1),blob=0,tree=0,commit=0;
  t.mock.method(globalThis,'fetch',async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url),method=options.method||'GET',headers=new Headers(options.headers);
    const body=typeof options.body==='string'?JSON.parse(options.body):options.body;
    calls.push({url:url.href,method,headers,body,redirect:options.redirect});
    if(url.hostname==='photography.njmurray.com'||url.hostname==='raw.githubusercontent.com'){
      assert.equal(headers.get('authorization'),null);assert.equal(headers.get('cookie'),null);assert.equal(options.redirect,'manual');
      return url.hostname==='photography.njmurray.com'?new Response('not deployed',{status:404}):new Response(method==='HEAD'?null:photo,{headers:{'Content-Type':'image/webp'}});
    }
    assert.equal(url.origin,'https://api.github.com','Every external request must be mocked.');
    assert.equal(headers.get('authorization'),`Bearer ${fakeToken}`);
    const path=url.pathname.slice('/repos/NicJMurray/photography'.length);
    if(path==='/git/blobs'&&method==='POST')return response({sha:sha(++blob)},201);
    if(path==='/git/ref/heads/main'&&method==='GET')return response({object:{sha:head}});
    if(path===`/git/commits/${head}`&&method==='GET')return response({tree:{sha:sha(100+tree)}});
    if(path==='/git/trees'&&method==='POST')return response({sha:sha(200+(++tree))},201);
    if(path==='/git/commits'&&method==='POST')return response({sha:sha(300+(++commit))},201);
    if(path==='/git/refs/heads/main'&&method==='PATCH'){
      assert.equal(body.force,false);if(beforeRefUpdate)await beforeRefUpdate();head=body.sha;return response({object:{sha:head}});
    }
    assert.fail(`Unexpected external request ${method} ${url.href}`);
  });
  return {calls,get head(){return head;}};
}
const upload=(f,cookie,options={})=>f.request('/api/shared/gallery',{method:'POST',cookie,body:multipart(options)});
const replace=(f,cookie,meta,options={})=>f.request('/api/shared/gallery/replace',{method:'POST',cookie,body:multipart({...options,meta})});
const result=async response=>{const text=await response.clone().text();assert.ok(response.ok,text);return response.json();};


test('three validated renditions publish HQ geometry while old two-rendition uploads remain valid',async t=>{
  const f=fixture(t),git=github(t),cookie=await f.login();
  const created=await upload(f,cookie);assert.equal(created.status,201);const {photo:published}=await created.json();
  assert.equal(published.revision,0);assert.ok(published.high.endsWith('/3840.webp'));assert.equal(published.highWidth,389);assert.equal(published.highHeight,306);
  const trees=git.calls.filter(call=>call.url.endsWith('/git/trees'));assert.equal(trees.length,1);
  assert.deepEqual(trees[0].body.tree.map(entry=>entry.path),[960,1920,3840].map(width=>`photos/uploads/${published.id}/${width}.webp`));
  const live=await f.gallery();assert.deepEqual(live.photos,[published]);assert.deepEqual(live.replacements,[]);assert.ok(!JSON.stringify(live).includes(fakeToken));
  const high=await f.request(new URL(published.high).pathname,{source:null});assert.equal(high.status,200);assert.equal(high.headers.get('content-type'),'image/webp');assert.deepEqual(new Uint8Array(await high.arrayBuffer()),photo);
  const old=await upload(f,cookie,{meta:{...metadata,file:'Other.jpg',height:301},small:alternate,large:alternate,high:null});assert.equal(old.status,201);const legacy=(await old.json()).photo;
  assert.equal(legacy.high,undefined);assert.equal(legacy.revision,0);
  assert.equal((await f.request(new URL(legacy.large).pathname.replace('/1920.webp','/3840.webp'),{source:null})).status,404,'Missing high resolution must not be exposed through a guessed route.');
});

test('HQ input size, type and decoded dimensions are checked before Git writes',async t=>{
  const f=fixture(t),git=github(t),cookie=await f.login();
  for(const options of [{high:new Uint8Array(6000001)},{highType:'image/jpeg'},{meta:{...metadata,height:301}},{high:alternate}]){
    const response=await upload(f,cookie,options);assert.equal(response.status,422,await response.clone().text());
  }
  const oversized=await f.request('/api/shared/gallery',{method:'POST',cookie,headers:{'Content-Type':'multipart/form-data; boundary=too-large'},body:new Uint8Array(10016385)});
  assert.equal(oversized.status,413);assert.equal(git.calls.length,0);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM gallery_photos').get().n,0);
});

test('all three renditions have EXIF and XMP removed before storage',async t=>{
  const f=fixture(t),git=github(t),cookie=await f.login();
  const dirty=chunk(chunk(photo,'EXIF','GPS latitude=51.5 longitude=-1.5'),'XMP ','Location: private');
  const response=await upload(f,cookie,{small:dirty,large:dirty,high:dirty});assert.equal(response.status,201);
  const blobs=git.calls.filter(call=>call.url.endsWith('/git/blobs'));assert.equal(blobs.length,3);
  for(const blob of blobs)assert.deepEqual(new Uint8Array(Buffer.from(blob.body.content,'base64')),photo);
});

test('replacement mutations keep authentication and exact trusted-origin checks',async t=>{
  const f=fixture(t),git=github(t),cookie=await f.login(),meta={...metadata,file:'DSCF0008.jpg',photoId:'dscf0008',revision:0};
  assert.equal((await replace(f,undefined,meta)).status,401);
  for(const source of [null,'https://other.njmurray.com'])assert.equal((await f.request('/api/shared/gallery/replace',{method:'POST',source,cookie,body:multipart({meta})})).status,403);
  assert.equal(git.calls.length,0);assert.equal((await f.gallery()).replacements.length,0);
});

test('unmatched names and hidden or deleted photos are skipped without Git writes',async t=>{
  const f=fixture(t),git=github(t),cookie=await f.login();
  for(const file of ['Unknown.jpg','dscf0008.jpg','DSCF0008.JPG','DSCF0008.jpeg']){
    const response=await replace(f,cookie,{...metadata,file,revision:0});assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{skipped:true,reason:'unmatched',file});
  }
  assert.equal(git.calls.length,0);
  assert.equal((await f.request('/api/shared/gallery/dscf0008',{method:'DELETE',cookie})).status,200);
  const hidden=await replace(f,cookie,{...metadata,file:'DSCF0008.jpg',photoId:'dscf0008',revision:0});assert.equal(hidden.status,200);assert.equal((await hidden.json()).reason,'unmatched');
  assert.equal(git.calls.length,0);
  const published=(await result(await upload(f,cookie))).photo;
  assert.equal((await f.request('/api/shared/gallery/'+published.id,{method:'DELETE',cookie})).status,200);
  const before=git.calls.length;
  const removed=await replace(f,cookie,{...metadata,photoId:published.id,revision:0});assert.equal(removed.status,200);assert.equal((await removed.json()).reason,'unmatched');
  assert.equal(git.calls.length,before);assert.deepEqual((await f.gallery()).photos,[]);
});

test('ambiguous visible filenames are skipped even when the client proposes one target',async t=>{
  const f=fixture(t),git=github(t),cookie=await f.login();
  const published=(await result(await upload(f,cookie,{meta:{...metadata,file:'DSCF0008.jpg'}}))).photo;
  const before=git.calls.length;
  const ambiguous=await replace(f,cookie,{...metadata,file:'DSCF0008.jpg',photoId:published.id,revision:0});assert.equal(ambiguous.status,200);
  assert.deepEqual(await ambiguous.json(),{skipped:true,reason:'ambiguous',file:'DSCF0008.jpg'});assert.equal(git.calls.length,before);
  assert.equal((await f.gallery()).replacements.length,0);
});

test('seed replacement preserves identity and leaves seed semantics for the frontend to retain',async t=>{
  const f=fixture(t),git=github(t),cookie=await f.login();
  const response=await replace(f,cookie,{...metadata,file:'DSCF0008.jpg',photoId:'dscf0008',revision:0});assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.replaced,true);const replaced=body.photo;
  assert.equal(replaced.id,'dscf0008');assert.equal(replaced.file,'DSCF0008.jpg');assert.equal(replaced.revision,1);
  assert.match(new URL(replaced.src).pathname,/\/replace-[a-f0-9-]{36}\/960\.webp$/);assert.equal(replaced.highWidth,389);assert.equal(replaced.highHeight,306);
  for(const field of ['title','alt','capturedAt','createdAt'])assert.equal(Object.hasOwn(replaced,field),false,`${field} must not replace the seed's value.`);
  const live=await f.gallery();assert.deepEqual(live.photos,[]);assert.equal(live.replacements.length,1);assert.equal(live.replacements[0].id,'dscf0008');assert.equal(live.replacements[0].src,replaced.src);
  const paths=git.calls.filter(call=>call.url.endsWith('/git/trees')).at(-1).body.tree.map(entry=>entry.path);
  const mediaId=new URL(replaced.src).pathname.split('/')[3];assert.deepEqual(paths,[960,1920,3840].map(width=>`photos/uploads/${mediaId}/${width}.webp`));
  assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM recipes').get().n,0);
  const image=await f.request(new URL(replaced.high).pathname,{source:null});assert.equal(image.status,200);
});

test('uploaded replacement retains public metadata and changes URLs rather than cached bytes in place',async t=>{
  const f=fixture(t);github(t);const cookie=await f.login();
  const original=(await result(await upload(f,cookie))).photo;
  const response=await replace(f,cookie,{...metadata,height:301,photoId:original.id,revision:0,title:'Do not change title',alt:'Do not change description',capturedAt:'2020-01-01T00:00:00Z'},{small:alternate,large:alternate,high:alternate});assert.equal(response.status,200);
  const {photo:replaced,replaced:success}=await response.json();assert.equal(success,true);
  for(const field of ['id','file','title','alt','capturedAt','createdAt'])assert.equal(replaced[field],original[field],field);
  assert.equal(replaced.revision,1);assert.equal(replaced.width,389);assert.equal(replaced.height,301);assert.equal(replaced.highHeight,301);
  assert.notEqual(replaced.src,original.src);assert.notEqual(replaced.large,original.large);assert.notEqual(replaced.high,original.high);
  const live=await f.gallery();assert.deepEqual(live.photos,[replaced]);assert.deepEqual(live.replacements,[]);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM gallery_photos').get().n,1,'Replacement must never create a second gallery entry.');
});

test('stale target or revision cannot overwrite another replacement and same-content retries make no commit',async t=>{
  const f=fixture(t),git=github(t),cookie=await f.login();
  const original=(await result(await upload(f,cookie))).photo;
  const beforeWrongId=git.calls.length;
  assert.equal((await replace(f,cookie,{...metadata,photoId:'dscf0008',revision:0})).status,409);assert.equal(git.calls.length,beforeWrongId);
  const first=(await result(await replace(f,cookie,{...metadata,height:301,photoId:original.id,revision:0},{small:alternate,large:alternate,high:alternate}))).photo;
  const before=git.calls.length;
  assert.equal((await replace(f,cookie,{...metadata,height:301,photoId:original.id,revision:0},{small:alternate,large:alternate,high:alternate})).status,409);assert.equal(git.calls.length,before);
  const duplicate=await replace(f,cookie,{...metadata,height:301,photoId:original.id,revision:first.revision},{small:alternate,large:alternate,high:alternate});assert.equal(duplicate.status,200);
  const retry=await duplicate.json();assert.equal(retry.duplicate,true);assert.equal(retry.photo.src,first.src);assert.equal(retry.photo.revision,first.revision);assert.equal(git.calls.length,before);
  assert.equal((await f.gallery()).photos[0].src,first.src);
});

test('removing a parent hides the replacement and disables every replacement media URL',async t=>{
  const f=fixture(t),git=github(t),cookie=await f.login();
  for(const target of [{id:'dscf0008',file:'DSCF0008.jpg'},(await result(await upload(f,cookie))).photo]){
    const replaced=(await result(await replace(f,cookie,{...metadata,file:target.file,photoId:target.id,revision:0}))).photo;
    assert.equal((await f.request('/api/shared/gallery/'+target.id,{method:'DELETE',cookie})).status,200);
    const before=git.calls.length;
    for(const field of ['src','large','high'])assert.equal((await f.request(new URL(replaced[field]).pathname,{source:null})).status,404);
    assert.equal(git.calls.length,before,'Hidden or deleted replacement media must not reach GitHub.');
    const live=await f.gallery();assert.ok(!live.photos.some(photo=>photo.id===target.id));assert.ok(!live.replacements.some(photo=>photo.id===target.id));
  }
});

test('a photo removed while Git storage is saving cannot be republished by replacement',async t=>{
  const f=fixture(t),cookie=await f.login();let removed=false;
  github(t,{beforeRefUpdate:async()=>{
    if(removed)return;removed=true;
    assert.equal((await f.request('/api/shared/gallery/dscf0008',{method:'DELETE',cookie})).status,200);
  }});
  const response=await replace(f,cookie,{...metadata,file:'DSCF0008.jpg',photoId:'dscf0008',revision:0});
  assert.equal(response.status,409,await response.clone().text());
  const live=await f.gallery();assert.ok(live.hidden.includes('dscf0008'));assert.deepEqual(live.replacements,[]);assert.deepEqual(live.photos,[]);
});

test('adding or changing an HQ rendition is not mistaken for an unchanged medium image',async t=>{
  const f=fixture(t),git=github(t),cookie=await f.login();
  // A valid extended WebP changes only the high-file bytes, with the same
  // decoded dimensions and identical 1920px rendition.
  const changedHigh=chunk(photo,'ICCP',new Uint8Array([1,2,3,4]));
  const original=(await result(await upload(f,cookie,{high:null}))).photo;
  const before=git.calls.filter(call=>call.url.endsWith('/git/commits')&&call.method==='POST').length;
  const upgraded=await result(await replace(f,cookie,{...metadata,photoId:original.id,revision:0}));
  assert.equal(upgraded.photo.revision,1);
  assert.ok(upgraded.photo.high.endsWith('/3840.webp'));
  assert.equal(git.calls.filter(call=>call.url.endsWith('/git/commits')&&call.method==='POST').length,before+1);
  const changed=await result(await replace(f,cookie,{...metadata,photoId:original.id,revision:1},{high:changedHigh}));
  assert.equal(changed.photo.revision,2);
  assert.notEqual(changed.photo.high,upgraded.photo.high);
  assert.equal(changed.photo.id,original.id);
});

test('a simultaneous replacement cannot overwrite the version that won while Git was saving',async t=>{
  const f=fixture(t),cookie=await f.login();
  const winner=`replace-${crypto.randomUUID()}`;
  let inserted=false;
  github(t,{beforeRefUpdate:async()=>{
    if(inserted)return;
    inserted=true;
    await f.db.batch([
      f.db.prepare('INSERT INTO gallery_media (id,photo_id,commit_sha,fingerprint,high_fingerprint,width,height,has_high,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(winner,'dscf0008',sha(900),'winner-medium','winner-high',389,306,1,new Date().toISOString()),
      f.db.prepare('INSERT INTO gallery_replacements (photo_id,media_id,revision) VALUES (?,?,?)').bind('dscf0008',winner,1),
    ]);
  }});
  const losing=await replace(f,cookie,{...metadata,file:'DSCF0008.jpg',photoId:'dscf0008',revision:0});
  assert.equal(losing.status,409);
  const live=await f.gallery();
  assert.equal(live.replacements.length,1);
  assert.equal(live.replacements[0].revision,1);
  assert.ok(live.replacements[0].high.includes(winner));
  assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM gallery_media').get().n,1,'The losing media record must be cleaned up.');
});
