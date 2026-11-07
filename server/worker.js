import {createRenderer} from './render.js';

const SESSION_COOKIE = '__Host-recipe_admin';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const MAX_PHOTO_BYTES = 1000000;
const encoder = new TextEncoder();
const PHOTO_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const securityHeaders = {
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'X-Frame-Options':'SAMEORIGIN',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'self'; img-src 'self' blob: https://images.unsplash.com; style-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
};

class HttpError extends Error {
  constructor(status,message,headers={}) { super(message);this.status=status;this.headers=headers; }
}
const hex = bytes => Array.from(new Uint8Array(bytes), byte=>byte.toString(16).padStart(2,'0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g)||[], byte=>parseInt(byte,16));
const digest = async text => hex(await crypto.subtle.digest('SHA-256',encoder.encode(text)));

async function passwordDigest(username,password,salt,iterations) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(`${username.toLowerCase()}\n${password}`),'PBKDF2',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(salt),iterations},key,256));
}

export async function createAuthConfig(username,password) {
  const salt=hex(crypto.getRandomValues(new Uint8Array(24)));
  const iterations=100000;
  return {username,salt,iterations,hash:hex(await passwordDigest(username,password,salt,iterations))};
}

async function equalBytes(provided,expected) {
  if (typeof crypto.subtle.timingSafeEqual==='function') return crypto.subtle.timingSafeEqual(provided,expected);
  // Web Crypto verification is also available in the Node test runtime.
  const key=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(71),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  const signature=await crypto.subtle.sign('HMAC',key,expected);
  return crypto.subtle.verify('HMAC',key,signature,provided);
}

function authConfig(env) {
  try {
    const auth=JSON.parse(env.ADMIN_AUTH || 'null');
    return auth && typeof auth.username==='string' && /^[a-f0-9]{48}$/.test(auth.salt) && /^[a-f0-9]{64}$/.test(auth.hash) && auth.iterations===100000 ? auth : null;
  } catch { return null; }
}

function json(value,status=200,extra={}) {
  return new Response(JSON.stringify(value),{status,headers:{...securityHeaders,'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie',...extra}});
}
function html(value,status=200,head=false) {
  return new Response(head?null:value,{status,headers:{...securityHeaders,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}

async function readBody(request,limit) {
  if (Number(request.headers.get('content-length'))>limit) throw new HttpError(413,'This upload is too large.');
  if (!request.body) return new Uint8Array();
  const reader=request.body.getReader();
  const chunks=[];let size=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if (size>limit) {await reader.cancel();throw new HttpError(413,'This upload is too large.');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const result=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}
  return result;
}
async function readJson(request,limit=512000) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415,'Send JSON data.');
  try {
    const value=JSON.parse(new TextDecoder().decode(await readBody(request,limit)));
    if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'Send a data object.');
    return value;
  }
  catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'The submitted data could not be read.');}
}
function checkOrigin(request,env) {
  const origin=new URL(request.url).origin;
  if(request.headers.get('origin')!==origin || (env.ADMIN_ORIGIN && origin!==env.ADMIN_ORIGIN)) throw new HttpError(403,'This request must come from the recipe website.');
}
function cookieToken(request) {
  const token=request.headers.get('cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length+1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
async function session(request,env) {
  if(!env.RECIPES_DB)return null;
  const token=cookieToken(request);if(!token)return null;
  const tokenHash=await digest(token);
  const row=await env.RECIPES_DB.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash = ?').bind(tokenHash).first();
  return row && row.expires_at>Date.now() ? {tokenHash} : null;
}
async function requireSession(request,env) {
  const active=await session(request,env);
  if(!active)throw new HttpError(401,'Please log in to edit recipes.');
  return active;
}
const cookie = (token,age=SESSION_SECONDS) => `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;

function text(value,name,max,required=false) {
  if(value===undefined || value===null || value==='') {
    if(required)throw new HttpError(422,`${name} is required.`);
    return '';
  }
  if(typeof value!=='string' || value.trim().length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new HttpError(422,`${name} is too long or invalid.`);
  const result=value.trim();
  if(required&&!result)throw new HttpError(422,`${name} is required.`);
  return result;
}

export function validateRecipe(raw,seed) {
  if(!raw || typeof raw!=='object' || Array.isArray(raw))throw new HttpError(422,'Recipe data is required.');
  const recipe={slug:seed.slug,title:text(raw.title,'Recipe title',160,true),description:text(raw.description,'Description',1600,true),category:raw.category,mealType:raw.mealType,imageKey:seed.imageKey};
  if(!['Fish & seafood','Vegetarian'].includes(recipe.category))throw new HttpError(422,'Choose a recipe category.');
  if(!['Breakfast','Lunch','Dinner'].includes(recipe.mealType))throw new HttpError(422,'Choose Breakfast, Lunch or Dinner.');
  if(!Array.isArray(raw.tags)||raw.tags.length>15)throw new HttpError(422,'Use up to 15 tags.');
  recipe.tags=[...new Set(raw.tags.map(tag=>text(tag,'Tag',60,true)))];
  for(const key of ['servings','prep','cook','timeLabel','temperature']){
    const value=text(raw[key],key,120);if(value)recipe[key]=value;
  }
  if(raw.totalMinutes!==undefined && raw.totalMinutes!==null && raw.totalMinutes!==''){
    if(!Number.isInteger(raw.totalMinutes)||raw.totalMinutes<1||raw.totalMinutes>10080)throw new HttpError(422,'Total minutes must be a whole number between 1 and 10,080.');
    recipe.totalMinutes=raw.totalMinutes;
  }
  if(!Array.isArray(raw.ingredients)||raw.ingredients.length<1||raw.ingredients.length>15)throw new HttpError(422,'Use 1–15 ingredient sections.');
  let count=0;
  recipe.ingredients=raw.ingredients.map(group=>{
    if(!group || !Array.isArray(group.items)||!group.items.length)throw new HttpError(422,'Each ingredient section needs an ingredient.');
    count+=group.items.length;
    return {title:text(group.title,'Ingredient section',100,true),items:group.items.map(item=>text(item,'Ingredient',500,true))};
  });
  if(count>200)throw new HttpError(422,'Use up to 200 ingredients.');
  if(!Array.isArray(raw.steps)||raw.steps.length<1||raw.steps.length>60)throw new HttpError(422,'Use 1–60 method steps.');
  recipe.steps=raw.steps.map((step,index)=>({title:text(step?.title,'Step title',140)||`Step ${index+1}`,text:text(step?.text,'Method step',6000,true)}));
  if(raw.notes!==undefined){
    if(!Array.isArray(raw.notes)||raw.notes.length>15)throw new HttpError(422,'Use up to 15 notes.');
    const notes=raw.notes.map(note=>text(note,'Recipe note',1600)).filter(Boolean);if(notes.length)recipe.notes=notes;
  }
  return recipe;
}

function validatePhoto(raw) {
  if(!raw || raw.kind==='original')return {kind:'original'};
  if(raw.kind!=='upload'||!PHOTO_ID.test(raw.id))throw new HttpError(422,'Choose an uploaded recipe photo.');
  return {kind:'upload',id:raw.id,alt:text(raw.alt,'Photo description',400,true),credit:text(raw.credit,'Photo credit',160)};
}

export function cleanWebp(bytes) {
  const string=(offset,length)=>String.fromCharCode(...bytes.subarray(offset,offset+length));
  if(bytes.length<20||string(0,4)!=='RIFF'||string(8,4)!=='WEBP')throw new HttpError(415,'Choose a photo using the photo uploader.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const end=view.getUint32(4,true)+8;
  if(end!==bytes.length)throw new HttpError(415,'The photo could not be read.');
  const chunks=[];let offset=12;let hasImage=false;
  while(offset<end){
    if(offset+8>end)throw new HttpError(415,'The photo could not be read.');
    const type=string(offset,4),length=view.getUint32(offset+4,true),size=8+length+(length%2);
    if(offset+size>end)throw new HttpError(415,'The photo could not be read.');
    if(type==='VP8 '||type==='VP8L')hasImage=true;
    if(type!=='EXIF'&&type!=='XMP '){
      const chunk=bytes.slice(offset,offset+size);
      if(type==='VP8X'&&length>=10)chunk[8]&=~0x0c;
      chunks.push(chunk);
    }
    offset+=size;
  }
  if(!hasImage)throw new HttpError(415,'The photo could not be read.');
  const length=12+chunks.reduce((sum,chunk)=>sum+chunk.length,0);
  const result=new Uint8Array(length);result.set(bytes.subarray(0,12));new DataView(result.buffer).setUint32(4,length-8,true);
  offset=12;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}
  return result;
}

async function reserveAttempt(db,scope,seconds,limit) {
  const window=Math.floor(Date.now()/(seconds*1000))*seconds*1000;
  const row=await db.prepare('INSERT INTO login_limits (scope,window_start,attempts) VALUES (?,?,1) ON CONFLICT(scope) DO UPDATE SET attempts=CASE WHEN login_limits.window_start=excluded.window_start THEN login_limits.attempts+1 ELSE 1 END, window_start=excluded.window_start WHERE login_limits.window_start<>excluded.window_start OR login_limits.attempts<? RETURNING attempts').bind(scope,window,limit).first();
  if(!row)throw new HttpError(429,'Too many login attempts. Please try again later.',{'Retry-After':String(Math.ceil((window+seconds*1000-Date.now())/1000))});
  return {scope,window};
}

export function createApp(seedRecipes,seedPhotos,shoppingMapping,assets) {
  const seeds=seedRecipes.map(({sourceChat,...recipe})=>recipe);
  const bySlug=new Map(seeds.map(recipe=>[recipe.slug,recipe]));

  async function catalog(env) {
    const rows=env.RECIPES_DB ? (await env.RECIPES_DB.prepare('SELECT slug,data,photo,revision,updated_at FROM recipes').all()).results : [];
    const saved=new Map(rows.map(row=>[row.slug,row]));
    const photos={...seedPhotos};
    const recipes=seeds.map(seed=>{
      const row=saved.get(seed.slug);if(!row)return seed;
      const recipe=JSON.parse(row.data),photo=JSON.parse(row.photo);
      if(photo.kind==='upload'){
        recipe.imageKey=`uploaded-${seed.slug}`;
        photos[recipe.imageKey]={src:`/uploads/${photo.id}`,alt:photo.alt,by:photo.credit||'Recipe book',credit:photo.credit,owned:true};
      }
      return recipe;
    });
    return {recipes,photos};
  }

  async function entry(env,slug) {
    const seed=bySlug.get(slug);if(!seed)throw new HttpError(404,'Recipe not found.');
    const row=await env.RECIPES_DB.prepare('SELECT data,photo,revision,updated_at FROM recipes WHERE slug=?').bind(slug).first();
    const photo=row?JSON.parse(row.photo):{kind:'original'};
    const original=seedPhotos[seed.imageKey];
    const url=photo.kind==='upload'?`/uploads/${photo.id}`:original.src||`https://images.unsplash.com/${original.id}?auto=format&fit=crop&w=1100&q=80`;
    return {recipe:row?JSON.parse(row.data):seed,photo:{...photo,url,...(photo.kind==='original'?{alt:original.alt,credit:original.by}:{} )},revision:row?.revision||0,updatedAt:row?.updated_at||null};
  }

  async function api(request,env,url) {
    const auth=authConfig(env);
    if(!['GET','HEAD'].includes(request.method))checkOrigin(request,env);
    if(url.pathname==='/api/session'&&request.method==='GET'){
      const active=auth?await session(request,env):null;
      return json({authenticated:Boolean(active),available:Boolean(auth&&env.RECIPES_DB),...(active?{username:auth.username}:{} )});
    }
    if(!auth||!env.RECIPES_DB)throw new HttpError(503,'Editing is temporarily unavailable.');
    if(url.pathname==='/api/login'&&request.method==='POST'){
      const body=await readJson(request,2048);
      if(typeof body.username!=='string'||typeof body.password!=='string'||body.username.length>100||body.password.length>256)throw new HttpError(400,'Enter your username and passphrase.');
      const ip=request.headers.get('CF-Connecting-IP')||'unknown';
      const ipScope=await digest(`${auth.salt}:${ip}`);
      const reservations=[];
      reservations.push(await reserveAttempt(env.RECIPES_DB,`ip:${ipScope}`,900,5));
      reservations.push(await reserveAttempt(env.RECIPES_DB,'account:hour',3600,20));
      reservations.push(await reserveAttempt(env.RECIPES_DB,'account:day',86400,80));
      const actual=await passwordDigest(body.username.trim(),body.password,auth.salt,auth.iterations);
      if(!await equalBytes(actual,unhex(auth.hash)))throw new HttpError(401,'The username or passphrase is incorrect.');
      const token=hex(crypto.getRandomValues(new Uint8Array(32)));
      await env.RECIPES_DB.batch([
        env.RECIPES_DB.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(Date.now()),
        env.RECIPES_DB.prepare('INSERT INTO admin_sessions (token_hash,expires_at) VALUES (?,?)').bind(await digest(token),Date.now()+SESSION_SECONDS*1000),
        ...reservations.map(({scope,window})=>env.RECIPES_DB.prepare('UPDATE login_limits SET attempts=MAX(0,attempts-1) WHERE scope=? AND window_start=?').bind(scope,window)),
      ]);
      return json({authenticated:true,username:auth.username},200,{'Set-Cookie':cookie(token)});
    }
    if(url.pathname==='/api/logout'&&request.method==='POST'){
      const active=await session(request,env);
      if(active)await env.RECIPES_DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(active.tokenHash).run();
      return json({authenticated:false},200,{'Set-Cookie':cookie('',0)});
    }
    const active=await requireSession(request,env);
    if(url.pathname==='/api/photos'&&request.method==='POST'){
      if(request.headers.get('content-type')?.split(';')[0]!=='image/webp')throw new HttpError(415,'Choose a photo using the photo uploader.');
      const bytes=cleanWebp(await readBody(request,MAX_PHOTO_BYTES));
      const id=crypto.randomUUID(),etag=hex(await crypto.subtle.digest('SHA-256',bytes));
      await env.RECIPES_DB.prepare('INSERT INTO recipe_photos (id,data,etag,created_at) VALUES (?,?,?,?)').bind(id,bytes.buffer,etag,new Date().toISOString()).run();
      return json({id,url:`/uploads/${id}`},201);
    }
    const match=url.pathname.match(/^\/api\/recipes\/([a-z0-9-]+)$/);
    if(match&&request.method==='GET')return json(await entry(env,match[1]));
    if(match&&request.method==='PUT'){
      const slug=match[1],seed=bySlug.get(slug);if(!seed)throw new HttpError(404,'Recipe not found.');
      const body=await readJson(request);
      if(!Number.isInteger(body.revision)||body.revision<0)throw new HttpError(422,'The recipe version is missing. Reload before saving.');
      const recipe=validateRecipe(body.recipe,seed),photo=validatePhoto(body.photo);
      if(photo.kind==='upload'&&!await env.RECIPES_DB.prepare('SELECT id FROM recipe_photos WHERE id=?').bind(photo.id).first())throw new HttpError(422,'Upload this photo again before saving.');
      const previous=await entry(env,slug);
      if(previous.revision!==body.revision)throw new HttpError(409,'This recipe was updated in another tab. Your draft is still here; reload the published recipe before saving again.');
      const now=new Date().toISOString(),revision=body.revision+1;
      const priorPhoto=validatePhoto(previous.photo);
      const results=await env.RECIPES_DB.batch([
        env.RECIPES_DB.prepare('INSERT OR IGNORE INTO recipe_versions (slug,revision,data,photo,updated_at) VALUES (?,?,?,?,?)').bind(slug,previous.revision,JSON.stringify(previous.recipe),JSON.stringify(priorPhoto),previous.updatedAt||now),
        env.RECIPES_DB.prepare('INSERT INTO recipes (slug,revision,data,photo,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET revision=excluded.revision,data=excluded.data,photo=excluded.photo,updated_at=excluded.updated_at WHERE recipes.revision=? RETURNING revision').bind(slug,revision,JSON.stringify(recipe),JSON.stringify(photo),now,body.revision),
      ]);
      if(!results[1].results?.length)throw new HttpError(409,'This recipe was updated in another tab. Your draft has not been published.');
      await env.RECIPES_DB.prepare('DELETE FROM recipe_versions WHERE slug=? AND revision<?').bind(slug,Math.max(0,revision-30)).run();
      return json(await entry(env,slug));
    }
    throw new HttpError(404,'That editor action was not found.');
  }

  async function handle(request,env) {
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/'))return api(request,env,url);
    if(url.pathname.startsWith('/uploads/')){
      if(!['GET','HEAD'].includes(request.method))throw new HttpError(405,'Method not allowed.');
      const id=url.pathname.slice('/uploads/'.length);
      if(!PHOTO_ID.test(id)||!env.RECIPES_DB)throw new HttpError(404,'Photo not found.');
      // Unpublished uploads are never exposed through the public image URL.
      const metadata=await env.RECIPES_DB.prepare("SELECT p.id,p.etag FROM recipe_photos p WHERE p.id=? AND EXISTS (SELECT 1 FROM recipes r WHERE json_extract(r.photo,'$.id')=p.id)").bind(id).first();
      if(!metadata)throw new HttpError(404,'Photo not found.');
      const headers={...securityHeaders,'Content-Type':'image/webp','Cache-Control':'public, max-age=86400','ETag':`"${metadata.etag}"`};
      if(request.headers.get('if-none-match')===headers.ETag)return new Response(null,{status:304,headers});
      if(request.method==='HEAD')return new Response(null,{headers});
      const row=await env.RECIPES_DB.prepare('SELECT data FROM recipe_photos WHERE id=?').bind(id).first();
      const bytes=row.data instanceof ArrayBuffer?new Uint8Array(row.data):Uint8Array.from(row.data);
      return new Response(bytes,{headers});
    }
    if(['GET','HEAD'].includes(request.method)){
      const path=url.pathname;
      if(/^\/recipes\/[^/]+$/.test(path)||['/meal-planner','/photography-credits'].includes(path))return Response.redirect(`${url.origin}${path}/${url.search}`,308);
      if(path.endsWith('/index.html'))return Response.redirect(`${url.origin}${path.slice(0,-10)}${url.search}`,308);
      const isHtml=path==='/'||path==='/index.html'||/^\/recipes\/[^/]+\/(?:index.html)?$/.test(path)||['/meal-planner/','/photography-credits/'].includes(path);
      if(isHtml){
        const {recipes,photos}=await catalog(env);
        const renderer=createRenderer(recipes,photos,shoppingMapping,assets);
        if(path==='/'||path==='/index.html')return html(renderer.hub,200,request.method==='HEAD');
        if(path==='/meal-planner/')return html(renderer.planner,200,request.method==='HEAD');
        if(path==='/photography-credits/')return html(renderer.credits,200,request.method==='HEAD');
        const slug=path.split('/')[2],recipe=recipes.find(recipe=>recipe.slug===slug);
        return html(recipe?renderer.recipePage(recipe):renderer.notFound,recipe?200:404,request.method==='HEAD');
      }
    }
    return env.ASSETS.fetch(request);
  }

  return {async fetch(request,env,ctx){
    try{return await handle(request,env);}
    catch(error){
      if(error instanceof HttpError)return json({error:error.message},error.status,error.headers);
      console.error(JSON.stringify({event:'recipe_request_failed',path:new URL(request.url).pathname}));
      return json({error:'The recipe book is temporarily unavailable. Please try again.'},503);
    }
  }};
}
