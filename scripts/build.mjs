import {readFile,writeFile,mkdir,rm,cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRenderer} from '../server/render.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'dist');
const read=filename=>readFile(path.join(root,filename),'utf8');
const recipes=JSON.parse(await read('content/recipes.json'));
const photos=JSON.parse(await read('content/photos.json'));
const shopping=JSON.parse(await read('content/shopping.json'));
const hash=async(...files)=>{const h=createHash('sha256');for(const file of files)h.update(await read(file));return h.digest('hex').slice(0,12);};
const assets={style:await hash('public/style.css'),app:await hash('public/app.js'),planner:await hash('public/planner.js','public/shopping-list.js'),admin:await hash('public/admin.js')};
const rendered=createRenderer(recipes,photos,shopping,assets);
await rm(out,{recursive:true,force:true});
await cp(path.join(root,'public'),out,{recursive:true});
const pages={'index.html':rendered.hub,'404.html':rendered.notFound,'meal-planner/index.html':rendered.planner,'photography-credits/index.html':rendered.credits};
for(const recipe of recipes)pages[`recipes/${recipe.slug}/index.html`]=rendered.recipePage(recipe);
for(const [filename,html] of Object.entries(pages)){await mkdir(path.dirname(path.join(out,filename)),{recursive:true});await writeFile(path.join(out,filename),html);}
const urls=['/','/meal-planner/',...recipes.map(r=>`/recipes/${r.slug}/`),'/photography-credits/'];
await writeFile(path.join(out,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url=>`<url><loc>https://recipes.njmurray.com${url}</loc></url>`).join('')}</urlset>`);
// Bundle the two dependency-free ES modules for Pages advanced mode. The same
// renderer creates static fallback files and the live database-backed pages.
const renderer=await read('server/render.js');
const worker=(await read('server/worker.js')).replace("import {createRenderer} from './render.js';",'');
const publicSeeds=recipes.map(({sourceChat,...recipe})=>recipe);
await writeFile(path.join(out,'_worker.js'),`${renderer}\n${worker}\nexport default createApp(${JSON.stringify(publicSeeds)},${JSON.stringify(photos)},${JSON.stringify(shopping)},${JSON.stringify(assets)});\n`);
await writeFile(path.join(out,'_routes.json'),JSON.stringify({version:1,include:['/','/index.html','/recipes/*','/meal-planner*','/photography-credits*','/api/*','/uploads/*'],exclude:[]},null,2));
console.log(`Built ${recipes.length} recipes, meal planner and Pages editor backend.`);
