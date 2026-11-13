import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDatabase} from './d1-adapter.mjs';
import {createApp,createAuthConfig,cleanWebp,validateRecipe} from '../server/worker.js';
import {inferShoppingEntry,buildShoppingList} from '../public/shopping-list.js';
const readJson=async filename=>JSON.parse(await readFile(new URL('../'+filename,import.meta.url),'utf8'));
const recipes=await readJson('content/recipes.json'),photos=await readJson('content/photos.json'),mapping=await readJson('content/shopping.json');
// Test-only credentials are separate from all deployed credentials.
const auth=JSON.stringify(await createAuthConfig('test-admin','test-passphrase'));
const origin='https://recipes.test';
async function fixture(){
 const db=createDatabase(),app=createApp(recipes,photos,mapping);
 const env={RECIPES_DB:db,ADMIN_AUTH:auth,ADMIN_ORIGIN:origin,ASSETS:{fetch:()=>new Response('static asset')}};
 const request=(pathname,{method='GET',body,cookie,headers={}}={})=>app.fetch(new Request(origin+pathname,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{Origin:origin}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env,{});
 const login=async()=>{const response=await request('/api/login',{method:'POST',body:{username:'TEST-ADMIN',password:'test-passphrase'}});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
 return {db,env,app,request,login};
}

test('shared login has a server-side session, secure cookie and explicit revocation',async()=>{
 const f=await fixture();assert.deepEqual(await (await f.request('/api/session')).json(),{authenticated:false,available:true});
 assert.equal((await f.request('/api/recipes/'+recipes[0].slug)).status,401);
 const response=await f.request('/api/login',{method:'POST',body:{username:'test-admin',password:'test-passphrase'}});
 const header=response.headers.get('set-cookie');assert.match(header,/__Host-recipe_admin=[a-f0-9]{64}/);assert.match(header,/HttpOnly; Secure; SameSite=Strict/);
 const cookie=header.split(';')[0];assert.equal((await (await f.request('/api/session',{cookie})).json()).authenticated,true);
 const token=cookie.split('=')[1],row=f.db.sqlite.prepare('SELECT token_hash FROM admin_sessions').get();assert.notEqual(row.token_hash,token);
 assert.equal((await f.request('/api/logout',{method:'POST',cookie})).status,200);assert.equal((await (await f.request('/api/session',{cookie})).json()).authenticated,false);
 const expired=await f.login();f.db.sqlite.exec('UPDATE admin_sessions SET expires_at=0');assert.equal((await f.request('/api/recipes/'+recipes[0].slug,{cookie:expired})).status,401);f.db.close();
});
test('invalid logins are bounded and mutation requests require the same origin',async()=>{
 const f=await fixture();
 for(let i=0;i<5;i++)assert.equal((await f.request('/api/login',{method:'POST',body:{username:'test-admin',password:'wrong'}})).status,401);
 const blocked=await f.request('/api/login',{method:'POST',body:{username:'test-admin',password:'wrong'}});assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('retry-after'))>0);
 assert.equal((await f.request('/api/login',{method:'POST',body:{username:'test-admin',password:'test-passphrase'},headers:{Origin:'https://other.test'}})).status,403);
 assert.equal((await f.request('/api/login',{method:'POST',body:null})).status,400);f.db.close();
});
test('edits publish to every server-rendered page, planner and later application instances',async()=>{
 const f=await fixture(),cookie=await f.login(),slug=recipes[0].slug;
 const before=await (await f.request('/api/recipes/'+slug,{cookie})).json();
 const recipe=structuredClone(before.recipe);recipe.title='Our new <salmon> & greens';recipe.description='A "new" description';recipe.mealType='Lunch';recipe.tags=['Favourite'];recipe.totalMinutes=15;
 recipe.ingredients[0].items.push('100g pasta');recipe.ingredients[0].items.reverse();recipe.steps.reverse();recipe.sourceChat='must not publish';recipe.unsafe='<script>alert(1)</script>';
 const saved=await f.request('/api/recipes/'+slug,{method:'PUT',cookie,body:{revision:0,recipe,photo:{kind:'original'}}});assert.equal(saved.status,200);
 const entry=await saved.json();assert.equal(entry.revision,1);assert.equal(entry.recipe.sourceChat,undefined);assert.equal(entry.recipe.unsafe,undefined);
 const html=await (await f.request('/recipes/'+slug+'/')).text();assert.ok(html.includes('Our new &lt;salmon&gt; &amp; greens'));assert.ok(!html.includes('must not publish'));assert.ok(html.includes('<span class="meal-label">Lunch</span>'));
 const schema=JSON.parse(html.match(/application\/ld\+json">([^<]+)/)[1]);assert.equal(schema.name,recipe.title);assert.equal(schema.recipeIngredient[0],recipe.ingredients[0].items[0]);assert.equal(schema.recipeInstructions[0].text,recipe.steps[0].text);
 const hub=await (await f.request('/')).text();assert.ok(hub.includes('data-meal="Lunch" data-quick="true"'));assert.ok(hub.includes('Our new &lt;salmon&gt;'));
 const planner=await (await f.request('/meal-planner/')).text();const data=JSON.parse(planner.match(/id="planner-data">([^<]+)/)[1]);assert.equal(data.recipes.find(r=>r.slug===slug).title,recipe.title);
 const newApp=createApp(recipes,photos,mapping);assert.ok((await (await newApp.fetch(new Request(origin+'/'),f.env,{})).text()).includes('Our new &lt;salmon&gt;'));
 const conflict=await f.request('/api/recipes/'+slug,{method:'PUT',cookie,body:{revision:0,recipe:{...recipe,title:'Overwrite'},photo:{kind:'original'}}});assert.equal(conflict.status,409);
 assert.equal(f.db.sqlite.prepare('SELECT title FROM (SELECT json_extract(data,\'$.title\') title FROM recipes)').get().title,recipe.title);
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM recipe_versions').get().n,1);assert.equal(f.db.sqlite.prepare('SELECT revision FROM recipe_versions').get().revision,0);
 assert.equal((await f.request('/recipes/'+slug)).status,308);assert.equal((await f.request('/meal-planner/index.html')).status,308);f.db.close();
});
test('recipe validation bounds inputs, preserves fixed URLs and accepts reordered content',async()=>{
 const seed=recipes[0];const clean=validateRecipe({...seed,slug:'changed',imageKey:'elsewhere'},seed);assert.equal(clean.slug,seed.slug);assert.equal(clean.imageKey,seed.imageKey);assert.equal(clean.sourceChat,undefined);
 for(const changes of [{title:''},{ingredients:[]},{steps:[]},{totalMinutes:-1},{tags:Array(16).fill('x')},{mealType:'Other'},{ingredients:[{title:'Ingredients',items:['']}]},{steps:[{title:'',text:''}]}])assert.throws(()=>validateRecipe({...seed,...changes},seed));
});
test('only authenticated photo uploads publish; metadata is removed and images have safe headers',async()=>{
 const f=await fixture(),cookie=await f.login(),slug=recipes[0].slug;
 const photo=new Uint8Array(await readFile(new URL('../public/images/mackerel-nicoise-salad.webp',import.meta.url)));
 const exif=new Uint8Array([69,88,73,70,4,0,0,0,1,2,3,4]);const bytes=new Uint8Array(photo.length+exif.length);bytes.set(photo);bytes.set(exif,photo.length);new DataView(bytes.buffer).setUint32(4,bytes.length-8,true);
 assert.deepEqual(cleanWebp(bytes),photo);assert.throws(()=>cleanWebp(new TextEncoder().encode('<svg onload=alert(1)>')));
 const upload=body=>f.app.fetch(new Request(origin+'/api/photos',{method:'POST',headers:{Origin:origin,'Content-Type':'image/webp',Cookie:cookie},body}),f.env,{});
 const anonymous=await f.app.fetch(new Request(origin+'/api/photos',{method:'POST',headers:{Origin:origin,'Content-Type':'image/webp'},body:photo}),f.env,{});assert.equal(anonymous.status,401);
 assert.equal((await upload(new Uint8Array(1000001))).status,413);
 const result=await upload(bytes);assert.equal(result.status,201);const uploaded=await result.json();assert.equal((await f.request(uploaded.url)).status,404);
 const saved=await f.request('/api/recipes/'+slug,{method:'PUT',cookie,body:{revision:0,recipe:recipes[0],photo:{kind:'upload',id:uploaded.id,alt:'Our cooked salmon',credit:'Nic'}}});assert.equal(saved.status,200);
 const response=await f.request(uploaded.url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),photo);
 const cached=await f.request(uploaded.url,{headers:{'If-None-Match':response.headers.get('etag')}});assert.equal(cached.status,304);
 const html=await (await f.request('/recipes/'+slug+'/')).text();assert.ok(html.includes(`<img src="${uploaded.url}"`));assert.ok(html.includes('<figcaption>Nic</figcaption>'));assert.ok(!html.includes('href="undefined"'));f.db.close();
});
test('public original recipes remain complete without authentication or browser JavaScript',async()=>{
 const f=await fixture();for(const recipe of recipes){const response=await f.request(`/recipes/${recipe.slug}/`);assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes('id="ingredients"'));assert.ok(html.includes('id="method"'));assert.ok(html.includes('id="admin-login"'));assert.ok(!html.includes('test-passphrase'));}
 const homepage=await f.request('/');assert.match(homepage.headers.get('content-security-policy'),/https:\/\/images\.pexels\.com/,'Worker responses must allow Pexels photos');const html=await homepage.text();assert.equal((html.match(/data-recipe data-category/g)||[]).length,recipes.length);assert.ok(!html.includes('<footer'));assert.ok(html.includes('page-end-space'));f.db.close();
});
test('edited plain amounts combine while ambiguous new wording stays explicit',()=>{
 assert.deepEqual(inferShoppingEntry('100g pasta',mapping),[{name:'Pasta',category:'Cupboard',quantity:{min:100,max:100,unit:'g'}}]);
 for(const original of ['a little pasta','100g cooked pasta','100g pasta or rice','100g pasta, cooked'])assert.equal(inferShoppingEntry(original,mapping)[0].quantity,null);
 const recipe={slug:'new',title:'New',ingredients:[{title:'Ingredients',items:['100g pasta']}]};const list=buildShoppingList([recipe],mapping,[{slug:'new',batches:2}]);assert.equal(list[0].total,'200g');
});
