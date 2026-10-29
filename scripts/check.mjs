import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'dist');
const recipes=JSON.parse(await readFile(path.join(root,'content/recipes.json'),'utf8'));
const photos=JSON.parse(await readFile(path.join(root,'content/photos.json'),'utf8'));
const expected=['Peanut-soy dressing prawn pasta salad','Blackened Fish Tacos','Apricot Pepper Rice Recipe','Curried Coconut Prawn Udon','Thai-style Salad Recipe','Harissa Tuna Pitta Recipe','Cheddar Jalapeño Egg Burritos','Crispy Chilli Egg Recipe','Mediterranean Squash Recipe','Boursin Salmon Traybake Recipe','Creamy Mushroom Pie Recipe'];
assert.deepEqual(recipes.map(r=>r.sourceChat).sort(),expected.sort(),'The 11 screenshot-confirmed chats must each appear exactly once.');
assert.equal(new Set(recipes.map(r=>r.slug)).size,recipes.length,'Recipe addresses must be unique.');
const hub=await readFile(path.join(out,'index.html'),'utf8');
assert.equal((hub.match(/data-recipe data-category=/g)||[]).length,11);
const pages=['index.html','photography-credits/index.html','404.html',...recipes.map(r=>`recipes/${r.slug}/index.html`)];
for(const recipe of recipes){
 assert.match(recipe.slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
 assert.ok(recipe.ingredients.length&&recipe.ingredients.every(g=>g.items.length));
 assert.ok(recipe.steps.length&&recipe.steps.every(s=>s.title&&s.text));
 const photo=photos[recipe.imageKey];assert.ok(photo?.id&&photo.by&&photo.page&&photo.alt);
 assert.equal(new URL(photo.page).hostname,'unsplash.com');
 const html=await readFile(path.join(out,'recipes',recipe.slug,'index.html'),'utf8');
 const structured=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
 assert.ok(structured,'Every recipe needs structured data.');
 const parsed=JSON.parse(structured);
 assert.equal(parsed.recipeIngredient.length,recipe.ingredients.flatMap(g=>g.items).length);
 assert.equal(parsed.recipeInstructions.length,recipe.steps.length);
 assert.ok(html.includes(`data-slug="${recipe.slug}"`));
 assert.equal((html.match(/data-ingredient="/g)||[]).length,parsed.recipeIngredient.length);
 assert.ok(hub.includes(`/recipes/${recipe.slug}/`));
}
for(const page of pages){
 const html=await readFile(path.join(out,page),'utf8');
 assert.ok(!/undefined|\[object Object\]|TODO|Lorem ipsum/.test(html),`Placeholder content in ${page}`);
 for(const m of html.matchAll(/(?:href|src)="(\/[^"?#]*)"/g)){
  const target=m[1].endsWith('/')?`${m[1]}index.html`:m[1];
  await access(path.join(out,target));
 }
 assert.ok(html.includes('name="viewport"'));
}
for(const file of ['style.css','app.js','favicon.svg','robots.txt','sitemap.xml','_headers'])await access(path.join(out,file));
// Catch accidental recipe normalization in the two recipes with explicitly discussed quantities.
const pie=recipes.find(r=>r.slug==='creamy-mushroom-pie');
assert.ok(pie.ingredients.flatMap(g=>g.items).includes('750ml whole milk'));
assert.ok(pie.ingredients.flatMap(g=>g.items).includes('500g mushrooms'));
const squash=recipes.find(r=>r.slug==='mediterranean-squash-halloumi');
assert.equal(squash.servings,undefined,'Do not invent a serving count for the original squash recipe.');
assert.ok(squash.ingredients.flatMap(g=>g.items).includes('Aubergine, diced'));
console.log(`Checked all ${recipes.length} source chats, ${pages.length} HTML pages, ingredient counts, structured data and local links.`);
