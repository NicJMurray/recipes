import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDatabase} from './d1-adapter.mjs';
import {createApp,createAuthConfig} from '../server/worker.js';

const read=async file=>JSON.parse(await readFile(new URL('../'+file,import.meta.url),'utf8'));
const app=createApp(await read('content/recipes.json'),await read('content/photos.json'),await read('content/shopping.json'));
const origin='https://recipes.njmurray.com',photography='https://photography.njmurray.com';
const auth=JSON.stringify(await createAuthConfig('content-test-admin','content-test-passphrase'));
const photo=new Uint8Array(await readFile(new URL('../public/images/mackerel-nicoise-salad.webp',import.meta.url)));
// This real, decodable fixture is 389 × 306. Small sources are never enlarged.
const metadata={file:'DSCF20260102.jpg',width:389,height:306,capturedAt:'2026-01-02T12:30:00Z',title:'A photograph',alt:'A photograph of lunch'};
const fakeToken='test-only-photography-token';
const sha=character=>character.repeat(40);
const jsonResponse=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

function fixture(t,{token=fakeToken}={}){
  const db=createDatabase();t.after(()=>db.close());
  const env={RECIPES_DB:db,ADMIN_AUTH:auth,ADMIN_ORIGIN:origin,PHOTO_GITHUB_TOKEN:token,ASSETS:{fetch:()=>new Response('asset')}};
  const request=(path,{method='GET',source=photography,cookie,body,headers={}}={})=>{
    const isJson=body&&Object.getPrototypeOf(body)===Object.prototype;
    return app.fetch(new Request(origin+path,{method,headers:{...(source?{Origin:source}:{}),...(cookie?{Cookie:cookie}:{}),...(isJson?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:isJson?JSON.stringify(body):body}:{})}),env,{});
  };
  const login=async()=>{
    const response=await request('/api/shared/login',{method:'POST',body:{username:'content-test-admin',password:'content-test-passphrase'}});
    assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
  };
  return {db,env,request,login};
}
function multipart({meta=metadata,small=photo,large=photo,type='image/webp',omitLarge=false}={}){
  const form=new FormData();form.set('metadata',typeof meta==='string'?meta:JSON.stringify(meta));
  form.set('small',new Blob([small],{type}),'960.webp');
  if(!omitLarge)form.set('large',new Blob([large],{type}),'1920.webp');
  return form;
}
function addChunk(bytes,type,payload){
  const data=typeof payload==='string'?new TextEncoder().encode(payload):payload;
  const result=new Uint8Array(bytes.length+8+data.length+(data.length%2));result.set(bytes);
  const offset=bytes.length;result.set(new TextEncoder().encode(type),offset);
  const view=new DataView(result.buffer);view.setUint32(offset+4,data.length,true);result.set(data,offset+8);
  view.setUint32(4,result.length-8,true);return result;
}
function mockGithub(t,{conflicts=0,failStatus=0,rawStatus=200,rawType='image/webp',rawThrows=false,pagesStatus=404,pagesType='image/webp',pagesThrows=false}={}){
  const calls=[];let head=sha('1'),blobNumber=0,treeNumber=0,commitNumber=0,remainingConflicts=conflicts;
  t.mock.method(globalThis,'fetch',async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url),method=options.method||'GET';
    const body=typeof options.body==='string'?JSON.parse(options.body):options.body;
    calls.push({url:url.href,method,headers:new Headers(options.headers),body,redirect:options.redirect});
    // Workers accepts manual or follow, and throws for redirect: error.
    if(options.redirect==='error')throw new TypeError('Unsupported redirect mode: error');
    if(url.hostname==='photography.njmurray.com'){
      assert.ok(url.pathname.startsWith('/photos/uploads/'));
      assert.equal(options.redirect,'manual','Media redirects must never be followed.');
      assert.equal(new Headers(options.headers).get('authorization'),null);
      assert.equal(new Headers(options.headers).get('cookie'),null);
      if(pagesThrows)throw new TypeError('Static image network failure');
      return new Response(method==='HEAD'?null:photo,{status:pagesStatus,headers:{'Content-Type':pagesType}});
    }
    if(url.hostname==='raw.githubusercontent.com'){
      assert.equal(options.redirect,'manual','Immutable media fetches must not follow redirects.');
      assert.equal(new Headers(options.headers).get('authorization'),null,'Public media fetches never carry a GitHub token.');
      assert.equal(new Headers(options.headers).get('cookie'),null,'Browser session cookies never reach GitHub.');
      if(rawThrows)throw new TypeError('Raw image network failure');
      return new Response(method==='HEAD'?null:photo,{status:rawStatus,headers:{'Content-Type':rawType,...(rawStatus>=300&&rawStatus<400?{'Location':'https://untrusted.example/redirected-image'}:{})}});
    }
    assert.equal(url.origin,'https://api.github.com','No unmocked network access is permitted.');
    assert.ok(url.pathname.startsWith('/repos/NicJMurray/photography/'));
    assert.equal(new Headers(options.headers).get('authorization'),`Bearer ${fakeToken}`);
    if(failStatus)return jsonResponse({message:'Private upstream details must not be shown'},failStatus);
    const path=url.pathname.slice('/repos/NicJMurray/photography'.length);
    if(path==='/git/blobs'&&method==='POST')return jsonResponse({sha:String(++blobNumber).padStart(40,'b')},201);
    if(path==='/git/ref/heads/main'&&method==='GET')return jsonResponse({object:{sha:head}});
    if(path===`/git/commits/${head}`&&method==='GET')return jsonResponse({tree:{sha:head===sha('1')?sha('2'):sha('8')}});
    if(path==='/git/trees'&&method==='POST')return jsonResponse({sha:String(++treeNumber).padStart(40,'c')},201);
    if(path==='/git/commits'&&method==='POST')return jsonResponse({sha:String(++commitNumber).padStart(40,'a')},201);
    if(path==='/git/refs/heads/main'&&method==='PATCH'){
      assert.equal(body.force,false,'Photo publication must never force-push over source changes.');
      if(remainingConflicts-->0){head=sha('9');return jsonResponse({message:'Reference changed'},422);}
      head=body.sha;return jsonResponse({object:{sha:head}});
    }
    assert.fail(`Unexpected GitHub request: ${method} ${path}`);
  });
  return {calls,get head(){return head;}};
}

test('public gallery and homepage reads need no login and expose no storage credentials',async t=>{
  const f=fixture(t);mockGithub(t);
  const gallery=await f.request('/api/shared/gallery',{source:null});
  assert.equal(gallery.status,200);assert.equal(gallery.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(await gallery.json(),{photos:[],hidden:[],available:true,replacements:[]});
  const homepage=await f.request('/api/shared/content/homepage',{source:null});
  assert.equal(homepage.status,200);assert.deepEqual(await homepage.json(),{content:{},revision:0});
  f.env.PHOTO_GITHUB_TOKEN='';
  assert.equal((await (await f.request('/api/shared/gallery')).json()).available,false);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM recipes').get().count,0);
});

test('all content mutations require both the owner session and a trusted browser Origin',async t=>{
  const f=fixture(t),github=mockGithub(t),cookie=await f.login();
  const actions=[
    ['/api/shared/gallery',{method:'POST',body:multipart()}],
    ['/api/shared/gallery/dscf0008',{method:'DELETE'}],
    ['/api/shared/content/homepage',{method:'PUT',body:{revision:0,content:{'section.art':'Art'}}}],
  ];
  for(const [path,options] of actions){
    assert.equal((await f.request(path,options)).status,401);
    assert.equal((await f.request(path,{...options,cookie,source:'https://untrusted.njmurray.com'})).status,403);
    assert.equal((await f.request(path,{...options,cookie,source:null})).status,403);
  }
  assert.equal(github.calls.length,0);
  for(const table of ['gallery_photos','gallery_hidden','site_content'])assert.equal(f.db.sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count,0);
});

test('homepage saves allowlisted plain text and rejects first-write and stale revision conflicts',async t=>{
  const f=fixture(t);mockGithub(t);const cookie=await f.login();
  const put=body=>f.request('/api/shared/content/homepage',{method:'PUT',source:'https://njmurray.com',cookie,body});
  assert.equal((await put({revision:4,content:{'section.art':'Art'}})).status,409,'A nonzero revision must not create a previously absent document.');
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM site_content').get().count,0);
  const content={'section.art':'  Art & photography  ','description.photography':'Literal <b>text</b> stays plain text.'};
  const first=await put({revision:0,content});assert.equal(first.status,200);
  const saved=await first.json();assert.deepEqual(saved,{content:{'section.art':'Art & photography','description.photography':content['description.photography']},revision:1});
  assert.equal((await put({revision:0,content:{'section.art':'Stale draft'}})).status,409);
  assert.equal((await put({revision:2,content:{'section.art':'Future draft'}})).status,409);
  assert.deepEqual(await (await f.request('/api/shared/content/homepage',{source:null})).json(),saved);
  const second=await put({revision:1,content:{'section.art':'New Art'}});assert.equal(second.status,200);assert.equal((await second.json()).revision,2);
  for(const body of [
    {revision:2,content:{'arbitrary.html':'unsafe'}},
    {revision:2,content:{'section.art':''}},
    {revision:2,content:{'section.art':'x'.repeat(1001)}},
    {revision:2,content:{'section.art':'bad\u0000text'}},
    {revision:2,content:{'section.art':5}},
    {revision:-1,content:{'section.art':'Art'}},
    {revision:2,content:[]},
  ])assert.equal((await put(body)).status,422);
  assert.deepEqual(await (await f.request('/api/shared/content/homepage')).json(),{content:{'section.art':'New Art'},revision:2});
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM recipes').get().count,0,'Homepage changes never create or alter recipe overrides.');
});

test('photo validation rejects oversized, malformed or incorrectly sized variants before calling GitHub',async t=>{
  const f=fixture(t),github=mockGithub(t),cookie=await f.login();
  const upload=body=>f.request('/api/shared/gallery',{method:'POST',cookie,body});
  assert.equal((await upload({metadata})).status,415);
  const cases=[
    [multipart({meta:'not json'}),422],
    [multipart({meta:{...metadata,file:'../private.jpg'}}),422],
    [multipart({meta:{...metadata,width:0}}),422],
    [multipart({meta:{...metadata,width:390}}),422],
    [multipart({meta:{...metadata,width:1.5}}),422],
    [multipart({meta:{...metadata,capturedAt:'not a date'}}),422],
    [multipart({meta:{...metadata,capturedAt:'2999-01-01T00:00:00Z'}}),422],
    [multipart({type:'image/jpeg'}),422],
    [multipart({omitLarge:true}),422],
    [multipart({small:new Uint8Array(2000001)}),422],
    [multipart({small:new Uint8Array([1,2,3])}),415],
    [multipart({small:addChunk(photo,'ANIM',new Uint8Array(6))}),422],
    [multipart({small:addChunk(photo,'VP8X',new Uint8Array(10))}),422],
  ];
  for(const [body,expected] of cases){const response=await upload(body);assert.equal(response.status,expected,await response.clone().text());}
  const tooLarge=await f.request('/api/shared/gallery',{method:'POST',cookie,headers:{'Content-Type':'multipart/form-data; boundary=test-boundary'},body:new Uint8Array(10016385)});
  assert.equal(tooLarge.status,413,'The streaming body limit applies even without Content-Length.');
  assert.equal(github.calls.length,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM gallery_photos').get().count,0);
});

test('uploads strip location metadata, commit both sizes safely and return duplicates without another commit',async t=>{
  const f=fixture(t),github=mockGithub(t),cookie=await f.login();
  const dirty=addChunk(addChunk(photo,'EXIF','GPS latitude=51 longitude=-1'),'XMP ','GPS location=private');
  const response=await f.request('/api/shared/gallery',{method:'POST',cookie,body:multipart({small:dirty,large:dirty})});
  assert.equal(response.status,201);const result=await response.json();assert.match(result.photo.id,/^upload-[a-f0-9-]{36}$/);
  assert.equal(result.photo.capturedAt,'2026-01-02T12:30:00.000Z');
  assert.match(result.photo.createdAt,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  const blobs=github.calls.filter(call=>call.url.endsWith('/git/blobs'));
  assert.equal(blobs.length,2);
  for(const call of blobs){assert.equal(call.body.encoding,'base64');assert.deepEqual(new Uint8Array(Buffer.from(call.body.content,'base64')),photo,'EXIF and XMP bytes never reach GitHub.');}
  const tree=github.calls.find(call=>call.url.endsWith('/git/trees'));
  assert.deepEqual(tree.body.tree.map(entry=>entry.path),[`photos/uploads/${result.photo.id}/960.webp`,`photos/uploads/${result.photo.id}/1920.webp`]);
  assert.ok(tree.body.tree.every(entry=>entry.mode==='100644'&&entry.type==='blob'));
  const row=f.db.sqlite.prepare('SELECT * FROM gallery_photos').get();assert.equal(row.commit_sha,github.head);assert.equal(row.width,389);assert.equal(row.height,306);assert.equal(result.photo.createdAt,row.created_at);
  const published=await (await f.request('/api/shared/gallery',{source:null})).json();
  assert.deepEqual(published.photos,[result.photo]);assert.ok(!JSON.stringify(published).includes(fakeToken));assert.ok(!JSON.stringify(published).includes(row.fingerprint));
  const callCount=github.calls.length;
  const duplicate=await f.request('/api/shared/gallery',{method:'POST',cookie,body:multipart()});
  assert.equal(duplicate.status,200);const repeated=await duplicate.json();assert.equal(repeated.duplicate,true);assert.equal(repeated.photo.id,result.photo.id);
  assert.equal(github.calls.length,callCount);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM gallery_photos').get().count,1);
});

test('a concurrent GitHub source update is retried without force-pushing or recreating blobs',async t=>{
  const f=fixture(t),github=mockGithub(t,{conflicts:1}),cookie=await f.login();
  const response=await f.request('/api/shared/gallery',{method:'POST',cookie,body:multipart()});assert.equal(response.status,201);
  const patches=github.calls.filter(call=>call.method==='PATCH');assert.equal(patches.length,2);assert.ok(patches.every(call=>call.body.force===false));
  assert.equal(github.calls.filter(call=>call.url.endsWith('/git/blobs')).length,2);
  const commits=github.calls.filter(call=>call.method==='POST'&&call.url.endsWith('/git/commits'));
  assert.deepEqual(commits.map(call=>call.body.parents),[[sha('1')],[sha('9')]],'Retry rebases the photo-only tree onto the latest source commit.');
  assert.equal(f.db.sqlite.prepare('SELECT commit_sha FROM gallery_photos').get().commit_sha,github.head);
});

test('missing credentials and GitHub failures never publish a gallery entry',async t=>{
  const f=fixture(t),github=mockGithub(t,{failStatus:403}),cookie=await f.login();
  const failed=await f.request('/api/shared/gallery',{method:'POST',cookie,body:multipart()});assert.equal(failed.status,503);
  const error=await failed.text();assert.ok(!error.includes(fakeToken));assert.ok(!error.includes('Private upstream details'));
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM gallery_photos').get().count,0);
  assert.deepEqual((await (await f.request('/api/shared/gallery')).json()).photos,[]);
  f.env.PHOTO_GITHUB_TOKEN='';const count=github.calls.length;
  assert.equal((await f.request('/api/shared/gallery',{method:'POST',cookie,body:multipart()})).status,503);
  assert.equal(github.calls.length,count);
});

test('public media uses the saved immutable Git commit without browser or GitHub credentials',async t=>{
  const f=fixture(t),github=mockGithub(t),cookie=await f.login();
  const uploaded=await (await f.request('/api/shared/gallery',{method:'POST',cookie,body:multipart()})).json();
  const mediaPath=new URL(uploaded.photo.src).pathname,pinned=f.db.sqlite.prepare('SELECT commit_sha FROM gallery_photos').get().commit_sha;
  const image=await f.request(mediaPath,{source:null});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp');assert.equal(image.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()),photo);
  const raw=github.calls.at(-1);assert.equal(raw.url,`https://raw.githubusercontent.com/NicJMurray/photography/${pinned}/photos/uploads/${uploaded.photo.id}/960.webp`);assert.equal(raw.redirect,'manual');
  const head=await f.request(mediaPath,{method:'HEAD',source:null});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal(github.calls.at(-1).method,'HEAD');
  const count=github.calls.length;
  assert.equal((await f.request(mediaPath.replace('/960.webp','/original.jpg'),{source:null})).status,404);assert.equal(github.calls.length,count);
});

test('removing uploads and seeded photos updates the public gallery without rewriting Git history',async t=>{
  const f=fixture(t),github=mockGithub(t),cookie=await f.login();
  const uploaded=await (await f.request('/api/shared/gallery',{method:'POST',cookie,body:multipart()})).json();const count=github.calls.length;
  const remove=id=>f.request('/api/shared/gallery/'+id,{method:'DELETE',cookie});
  assert.equal((await remove(uploaded.photo.id)).status,200);assert.equal((await remove(uploaded.photo.id)).status,200);
  assert.ok(f.db.sqlite.prepare('SELECT deleted_at FROM gallery_photos').get().deleted_at);
  assert.equal((await f.request(new URL(uploaded.photo.src).pathname,{source:null})).status,404);
  assert.equal((await remove('dscf0008')).status,200);assert.equal((await remove('dscf0008')).status,200);
  assert.equal((await remove('not-a-photo')).status,404);
  assert.deepEqual(await (await f.request('/api/shared/gallery',{source:null})).json(),{photos:[],hidden:['dscf0008'],available:true,replacements:[]});
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM gallery_hidden').get().count,1);
  assert.equal(github.calls.length,count,'Removal changes metadata only; recoverable Git history stays intact.');
});


test('simultaneous duplicate uploads publish one entry and deletion permits a later reupload',async t=>{
  const f=fixture(t);mockGithub(t);const cookie=await f.login();
  const upload=()=>f.request('/api/shared/gallery',{method:'POST',cookie,body:multipart()});
  const responses=await Promise.all([upload(),upload()]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,201]);
  const results=await Promise.all(responses.map(response=>response.json()));
  assert.equal(results[0].photo.id,results[1].photo.id);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM gallery_photos WHERE deleted_at IS NULL').get().count,1);
  assert.equal((await f.request('/api/shared/gallery/'+results[0].photo.id,{method:'DELETE',cookie})).status,200);
  const repeated=await upload();assert.equal(repeated.status,201);
  assert.notEqual((await repeated.json()).photo.id,results[0].photo.id);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM gallery_photos').get().count,2);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) count FROM gallery_photos WHERE deleted_at IS NULL').get().count,1);
});

test('media serves deployed image bytes first and fails safely if both delivery sources are unavailable',async t=>{
  const f=fixture(t),github=mockGithub(t,{pagesStatus:200}),cookie=await f.login();
  const uploaded=await (await f.request('/api/shared/gallery',{method:'POST',cookie,body:multipart()})).json();
  const path=new URL(uploaded.photo.src).pathname,count=github.calls.length;
  const image=await f.request(path,{source:null});assert.equal(image.status,200);assert.deepEqual(new Uint8Array(await image.arrayBuffer()),photo);
  assert.equal(github.calls.length,count+1);assert.match(github.calls.at(-1).url,/^https:\/\/photography\.njmurray\.com\/photos\/uploads\//);
  // Replace the delivery stub only; there are no further authenticated writes.
  const failed=[];
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
    assert.equal(options.redirect,'manual');
    assert.equal(new Headers(options.headers).get('authorization'),null);
    assert.equal(new Headers(options.headers).get('cookie'),null);
    failed.push(String(url));return new Response('Unavailable',{status:503});
  });
  assert.equal((await f.request(path,{source:null})).status,503);
  assert.equal(failed.length,2);assert.match(failed[1],/^https:\/\/raw\.githubusercontent\.com\/NicJMurray\/photography\/[a-f0-9]{40}\//);
});


test('static image network errors fall back to immutable raw media in the Workers redirect mode',async t=>{
  const f=fixture(t),github=mockGithub(t,{pagesThrows:true}),cookie=await f.login();
  const uploaded=await (await f.request('/api/shared/gallery',{method:'POST',cookie,body:multipart()})).json();
  const before=github.calls.length;
  const response=await f.request(new URL(uploaded.photo.src).pathname,{source:null});
  assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),photo);
  const media=github.calls.slice(before);assert.equal(media.length,2);
  assert.equal(new URL(media[0].url).hostname,'photography.njmurray.com');
  assert.equal(new URL(media[1].url).hostname,'raw.githubusercontent.com');
  assert.ok(media.every(call=>call.redirect==='manual'&&!call.headers.has('authorization')&&!call.headers.has('cookie')));
});

test('network failures from both media sources produce a specific photo error',async t=>{
  const f=fixture(t),github=mockGithub(t,{pagesThrows:true,rawThrows:true}),cookie=await f.login();
  const uploaded=await (await f.request('/api/shared/gallery',{method:'POST',cookie,body:multipart()})).json();
  const before=github.calls.length;
  const response=await f.request(new URL(uploaded.photo.src).pathname,{source:null});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'This photo is temporarily unavailable. Please try again shortly.'});
  assert.equal(github.calls.length,before+2);
});

test('raw media must be WebP even on HTTP 200 and raw redirects are rejected without following them',async t=>{
  for(const options of [{rawType:'text/html'},{rawStatus:302}]){
    await t.test(JSON.stringify(options),async sub=>{
      const f=fixture(sub),github=mockGithub(sub,options),cookie=await f.login();
      const uploaded=await (await f.request('/api/shared/gallery',{method:'POST',cookie,body:multipart()})).json();
      const before=github.calls.length;
      const response=await f.request(new URL(uploaded.photo.src).pathname,{source:null});
      assert.equal(response.status,503);
      assert.deepEqual(await response.json(),{error:'This photo is temporarily unavailable. Please try again shortly.'});
      const calls=github.calls.slice(before);assert.equal(calls.length,2);
      assert.ok(calls.every(call=>call.redirect==='manual'&&!call.headers.has('authorization')&&!call.headers.has('cookie')));
      assert.ok(calls.every(call=>new URL(call.url).hostname!=='untrusted.example'));
    });
  }
});
