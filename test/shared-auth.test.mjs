import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDatabase} from './d1-adapter.mjs';
import {createApp,createAuthConfig} from '../server/worker.js';

const read=async file=>JSON.parse(await readFile(new URL('../'+file,import.meta.url),'utf8'));
const app=createApp(await read('content/recipes.json'),await read('content/photos.json'),await read('content/shopping.json'));
const origin='https://recipes.njmurray.com',photography='https://photography.njmurray.com';
const auth=JSON.stringify(await createAuthConfig('shared-test-admin','shared-test-passphrase'));
function fixture(){
  const db=createDatabase();
  const env={RECIPES_DB:db,ADMIN_AUTH:auth,ADMIN_ORIGIN:origin,ASSETS:{fetch:()=>new Response('asset')}};
  const request=(path,{method='GET',source=photography,cookie,body,headers={},host=origin}={})=>app.fetch(new Request(host+path,{method,headers:{...(source?{Origin:source}:{}),...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),env,{});
  return {db,env,request};
}

test('shared clients reuse and revoke the original host-only recipe session',async()=>{
  const f=fixture();
  const login=await f.request('/api/shared/login',{method:'POST',body:{username:'shared-test-admin',password:'shared-test-passphrase'}});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie');
  assert.match(cookie,/^__Host-recipe_admin=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict/);
  assert.ok(!cookie.includes('Domain='),'Keep the session confined to the authentication host.');
  assert.equal(login.headers.get('access-control-allow-origin'),photography);
  assert.equal(login.headers.get('access-control-allow-credentials'),'true');
  const token=cookie.split(';')[0];
  for(const source of [photography,'https://njmurray.com','https://www.njmurray.com',origin]){
    const response=await f.request('/api/shared/session',{cookie:token,source});
    assert.equal((await response.json()).authenticated,true);
    assert.equal(response.headers.get('access-control-allow-origin'),source);
    assert.match(response.headers.get('vary'),/Origin/);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
  assert.equal((await (await f.request('/api/session',{cookie:token,source:origin})).json()).authenticated,true);
  const loggedOut=await f.request('/api/shared/logout',{method:'POST',cookie:token,source:'https://njmurray.com'});
  assert.equal(loggedOut.status,200);assert.match(loggedOut.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await (await f.request('/api/session',{cookie:token,source:origin})).json()).authenticated,false);
  f.db.close();
});

test('shared CORS permits only named production websites and protects deployment aliases',async()=>{
  const f=fixture();
  const preflight=await f.request('/api/shared/gallery',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-origin'),photography);
  assert.equal(preflight.headers.get('access-control-allow-headers'),'Content-Type');
  for(const source of ['https://evil.test','https://untrusted.njmurray.com','https://photography.njmurray.com.evil.test',null]){
    const response=await f.request('/api/shared/login',{method:'POST',source,body:{username:'shared-test-admin',password:'shared-test-passphrase'}});
    assert.equal(response.status,403);assert.equal(response.headers.get('access-control-allow-origin'),null);
  }
  const alias=await f.request('/api/shared/login',{method:'POST',host:'https://preview.recipes-3tk.pages.dev',body:{username:'shared-test-admin',password:'shared-test-passphrase'}});
  assert.equal(alias.status,403);
  const privateRead=await f.request('/api/shared/session',{source:'https://untrusted.njmurray.com'});
  assert.equal(privateRead.status,403);assert.equal(privateRead.headers.get('access-control-allow-origin'),null);
  const recipeWrite=await f.request('/api/photos',{method:'POST',body:{}});
  assert.equal(recipeWrite.status,403,'Shared access must not broaden legacy recipe mutation origins.');
  f.db.close();
});

test('shared authentication retains login limits and readable cross-origin error responses',async()=>{
  const f=fixture();
  for(let i=0;i<5;i++){
    const response=await f.request('/api/shared/login',{method:'POST',body:{username:'shared-test-admin',password:'incorrect'}});
    assert.equal(response.status,401);assert.equal(response.headers.get('access-control-allow-origin'),photography);
  }
  const limited=await f.request('/api/shared/login',{method:'POST',body:{username:'shared-test-admin',password:'incorrect'}});
  assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
  assert.equal(limited.headers.get('access-control-allow-credentials'),'true');
  f.db.close();
});
