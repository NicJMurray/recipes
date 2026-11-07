import {createServer} from 'node:http';
import {readFile,stat,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createApp,createAuthConfig} from '../server/worker.js';
import {createDatabase} from './d1-adapter.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const readJson=async filename=>JSON.parse(await readFile(path.join(root,filename),'utf8'));
await mkdir(path.join(root,'.local'),{recursive:true});
const RECIPES_DB=createDatabase(path.join(root,'.local/recipes.sqlite'));
// Fictional local preview credentials. Never used or accepted in production.
const ADMIN_AUTH=JSON.stringify(await createAuthConfig('preview','editor-preview'));
const app=createApp(await readJson('content/recipes.json'),await readJson('content/photos.json'),await readJson('content/shopping.json'));
const types={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.html':'text/html','.xml':'application/xml','.txt':'text/plain'};
const ASSETS={async fetch(request){let filename=path.resolve(root,'dist','.'+new URL(request.url).pathname);if(!filename.startsWith(path.join(root,'dist')+path.sep))return new Response('Not found',{status:404});try{if((await stat(filename)).isDirectory())filename=path.join(filename,'index.html');return new Response(await readFile(filename),{headers:{'Content-Type':types[path.extname(filename)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}}};
createServer(async(req,res)=>{
  try{
    if(req.headers.cookie)req.headers.cookie=req.headers.cookie.replace(/preview_admin=/g,'__Host-recipe_admin=');
    const origin=`http://${req.headers.host}`;
    // A disposable fixture session lets browser tests exercise the editor
    // without entering credentials. This route exists only in this harness.
    if(req.url==='/preview-editor'){
      const signedIn=await app.fetch(new Request(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'preview',password:'editor-preview'})}),{RECIPES_DB,ADMIN_AUTH,ADMIN_ORIGIN:origin},{});
      res.writeHead(302,{'Location':'/','Set-Cookie':signedIn.headers.get('set-cookie').replace('__Host-recipe_admin','preview_admin').replace('; Secure','')});res.end();return;
    }
    const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})});
    const response=await app.fetch(request,{RECIPES_DB,ADMIN_AUTH,ADMIN_ORIGIN:origin,ASSETS},{});
    res.statusCode=response.status;
    for(const [key,value] of response.headers){
      // Only the isolated HTTP test harness uses an unprefixed cookie without
      // Secure. Production always has the __Host prefix and Secure attribute.
      res.setHeader(key,key==='set-cookie'?value.replace('__Host-recipe_admin','preview_admin').replace('; Secure',''):value);
    }
    res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Preview request failed.');}
}).listen(Number(process.env.PORT)||4173,'0.0.0.0',()=>console.log('Recipe editor preview ready.'));
