import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'dist');
const recipes=JSON.parse(await readFile(path.join(root,'content/recipes.json'),'utf8'));
const photos=JSON.parse(await readFile(path.join(root,'content/photos.json'),'utf8'));
const expected=['Peanut-soy dressing prawn pasta salad','Blackened Fish Tacos','Apricot Pepper Rice Recipe','Curried Coconut Prawn Udon','Thai-style Salad Recipe','Harissa Tuna Pitta Recipe','Cheddar Jalapeño Egg Burritos','Crispy Chilli Egg Recipe','Mediterranean Squash Recipe','Boursin Salmon Traybake Recipe','Creamy Mushroom Pie Recipe','Lasagne Recipe Transcript','Supplied screenshot — Smoked salmon, scrambled eggs & avocado','Supplied screenshot — Halloumi breakfast skillet','Supplied screenshot — Mackerel Niçoise salad','Blend recipes customisation'];
assert.deepEqual(recipes.map(r=>r.sourceChat).sort(),expected.sort(),'Every approved source chat must appear exactly once.');
assert.equal(new Set(recipes.map(r=>r.slug)).size,recipes.length,'Recipe addresses must be unique.');
const hub=await readFile(path.join(out,'index.html'),'utf8');
assert.equal((hub.match(/data-recipe data-category=/g)||[]).length,recipes.length);
const pages=['index.html','meal-planner/index.html','photography-credits/index.html','404.html',...recipes.map(r=>`recipes/${r.slug}/index.html`)];
for(const recipe of recipes){
 assert.match(recipe.slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
 assert.ok(recipe.ingredients.length&&recipe.ingredients.every(g=>g.items.length));
 assert.ok(recipe.steps.length&&recipe.steps.every(s=>s.title&&s.text));
 assert.ok(['Breakfast','Lunch','Dinner'].includes(recipe.mealType),'Every recipe needs a meal label.');
 const photo=photos[recipe.imageKey];assert.ok(photo?.alt&&photo.by&&(photo.id||photo.src));
 if(photo.src && /^https:\/\//.test(photo.src)) { assert.equal(new URL(photo.src).hostname,'images.pexels.com'); assert.equal(new URL(photo.page).hostname,'www.pexels.com'); }
 else if(photo.src) await access(path.join(out,photo.src));
 else assert.equal(new URL(photo.page).hostname,'unsplash.com');
 const html=await readFile(path.join(out,'recipes',recipe.slug,'index.html'),'utf8');
 const structured=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
 assert.ok(structured,'Every recipe needs structured data.');
 const parsed=JSON.parse(structured);
 assert.equal(parsed.recipeIngredient.length,recipe.ingredients.flatMap(g=>g.items).length);
 assert.equal(parsed.recipeInstructions.length,recipe.steps.length);
 assert.ok(parsed.recipeCategory.includes(recipe.mealType));
 assert.ok(html.includes(`<span class="meal-label">${recipe.mealType}</span>`));
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
for(const file of ['style.css','app.js','planner.js','shopping-list.js','favicon.svg','robots.txt','sitemap.xml','_headers'])await access(path.join(out,file));
// Catch accidental recipe normalization in the two recipes with explicitly discussed quantities.
const pie=recipes.find(r=>r.slug==='creamy-mushroom-pie');
assert.ok(pie.ingredients.flatMap(g=>g.items).includes('750ml whole milk'));
assert.ok(pie.ingredients.flatMap(g=>g.items).includes('500g mushrooms'));
const squash=recipes.find(r=>r.slug==='mediterranean-squash-halloumi');
assert.equal(squash.servings,undefined,'Do not invent a serving count for the original squash recipe.');
assert.ok(squash.ingredients.flatMap(g=>g.items).includes('Aubergine, diced'));
console.log(`Checked all ${recipes.length} source chats, ${pages.length} HTML pages, ingredient counts, structured data and local links.`);


const lasagne=recipes.find(r=>r.slug==='mrs-murrays-lasagne');
assert.equal(lasagne.title,"Mrs Murray's Lasagne");
assert.ok(!/courgette/i.test(JSON.stringify(lasagne)));
assert.ok(!hub.includes('<footer'),'Keep the footer text removed.');
const planner=await readFile(path.join(out,'meal-planner/index.html'),'utf8');
assert.ok(planner.includes('https://recipes.njmurray.com/meal-planner/'));
const plannerData=JSON.parse(planner.match(/<script type="application\/json" id="planner-data">([\s\S]*?)<\/script>/)[1]);
assert.equal(plannerData.recipes.length,recipes.length);
assert.ok(!JSON.stringify(plannerData).includes('sourceChat'),'Do not publish source chat metadata.');
assert.ok(plannerData.recipes.every(recipe=>['Breakfast','Lunch','Dinner'].includes(recipe.mealType)));
assert.ok((await readFile(path.join(out,'sitemap.xml'),'utf8')).includes('/meal-planner/'));
for(const recipe of recipes){
 const html=await readFile(path.join(out,'recipes',recipe.slug,'index.html'),'utf8');
 assert.ok(html.includes(`/meal-planner/?add=${recipe.slug}`));
}
for(const meal of ['Breakfast','Lunch','Dinner']) assert.ok(hub.includes(`data-filter="${meal}"`));
for(const recipe of recipes) assert.ok(hub.includes(`data-meal="${recipe.mealType}"`));
const mackerel=recipes.find(recipe=>recipe.slug==='mackerel-nicoise-salad');
assert.ok(mackerel.ingredients.flatMap(group=>group.items).includes('Potatoes'),'Potatoes are required in the mackerel salad.');
for(const slug of ['mackerel-nicoise-salad','smoked-salmon-eggs-avocado','halloumi-breakfast-skillet']){
 const recipe=recipes.find(recipe=>recipe.slug===slug);
 assert.ok(recipe);
 assert.equal(recipe.servings,undefined,'Do not invent servings for the screenshot recipes.');
 assert.equal(recipe.totalMinutes,undefined,'Do not invent timings for the screenshot recipes.');
 assert.equal(photos[recipe.imageKey].supplied,true,'Use supplied photos for these recipes.');
 assert.ok(!photos[recipe.imageKey].generated,'No generated image may be used for these additions.');
}



const stroganoff=recipes.find(recipe=>recipe.slug==='mushroom-stroganoff-gnocchi');
assert.ok(stroganoff,'The approved stroganoff gnocchi should be present.');
assert.equal(stroganoff.servings,'4');
assert.equal(stroganoff.title,'Mushroom stroganoff gnocchi with butter beans');
assert.equal(stroganoff.imageKey,'stroganoff-gnocchi');
assert.equal(stroganoff.mealType,'Dinner');
for(const ingredient of ['10g dried porcini mushrooms','75ml dry red wine','120g full-fat sour cream','2 tsp soy sauce','1 tsp vegetarian Worcestershire sauce (anchovy-free)','1 tsp tomato purée']){
 assert.ok(stroganoff.ingredients.flatMap(group=>group.items).includes(ingredient),`Missing approved ingredient: ${ingredient}`);
}

const photoPolicy=await readFile(path.join(out,'_headers'),'utf8');
assert.ok(photoPolicy.includes('https://images.pexels.com'),'Allow the approved Pexels photo to render under CSP.');
assert.ok(photos['stroganoff-gnocchi'].src.startsWith('https://images.pexels.com/photos/15611223/pexels-photo-15611223.jpeg'),'Use the canonical photo asset.');
