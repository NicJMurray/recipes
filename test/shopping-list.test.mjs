import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildShoppingList, normalizePlan, listAsText} from '../public/shopping-list.js';

const recipes = JSON.parse(await readFile(new URL('../content/recipes.json', import.meta.url), 'utf8'));
const mapping = JSON.parse(await readFile(new URL('../content/shopping.json', import.meta.url), 'utf8'));
const meal = (slug, batches = 1, id = slug) => ({id,slug,day:'Any day',batches});
const list = (meals, optional = false) => buildShoppingList(recipes, mapping, meals, optional);

test('every original ingredient is represented and all measures are valid', () => {
  const originals = new Set(recipes.flatMap(recipe => recipe.ingredients.flatMap(group => group.items)));
  assert.deepEqual([...originals].sort(), Object.keys(mapping).sort());
  for (const [original, entries] of Object.entries(mapping)) for (const entry of entries) {
    assert.ok(entry.name && entry.category, original);
    if (entry.quantity) {
      assert.ok(Number.isFinite(entry.quantity.min) && entry.quantity.min > 0, original);
      assert.ok(entry.quantity.max >= entry.quantity.min, original);
    }
  }
  const all = list(recipes.map(recipe => meal(recipe.slug)), true);
  const outputOriginals = new Set(all.flatMap(item => item.sources.map(source => source.original)));
  assert.deepEqual([...outputOriginals].sort(), [...originals].sort());
});

test('compatible pasta quantities add as ranges, without changing originals', () => {
  const items = list([meal('boursin-salmon-traybake'),meal('peanut-soy-prawn-pasta-salad')]);
  const pasta = items.find(item => item.name === 'Pasta');
  assert.equal(pasta.total, '550–600g');
  assert.deepEqual(pasta.sources.map(source => source.original), ['300–350g pasta','250g pasta']);
  const oil = items.find(item => item.name === 'Olive oil');
  assert.equal(oil.total, '2 tbsp + unmeasured');
});

test('repeat cooking, batch multipliers, ranges and packaged amounts scale', () => {
  const items = list([meal('boursin-salmon-traybake',2),meal('boursin-salmon-traybake',1,'second'),meal('curried-coconut-prawn-udon',2)]);
  assert.equal(items.find(item => item.name === 'Pasta').total, '900–1050g');
  assert.equal(items.find(item => item.name === 'Salmon fillets').total, '12');
  assert.equal(items.find(item => item.name === 'Tomatoes').total, '4½ punnets');
  assert.equal(items.find(item => item.name === 'Straight-to-wok udon noodles').total, '4 × 150g');
});

test('optional groups and optional inline ingredients are opt-in', () => {
  const meals = [meal('boursin-salmon-traybake'),meal('blackened-fish-tacos')];
  assert.ok(!list(meals).some(item => ['Capers','Cayenne','Red chilli','Feta'].includes(item.name)));
  for (const name of ['Capers','Cayenne','Red chilli','Feta']) assert.ok(list(meals,true).some(item => item.name === name && item.optional));
});

test('alternatives, unmeasured ingredients and distinct preparations remain explicit', () => {
  const items = list([meal('mrs-murrays-lasagne',2),meal('creamy-mushroom-pie'),meal('thai-style-watermelon-prawn-salad'),meal('curried-coconut-prawn-udon')],true);
  const squash = items.find(item => item.name === 'Butternut squash');
  assert.equal(squash.total,'');
  assert.equal(squash.sources[0].original,'Butternut squash, diced');
  assert.equal(squash.sources[0].batches,2);
  assert.equal(items.find(item => item.name === 'Banana shallots or onions').sources[0].original,'4 banana shallots or 2 onions');
  assert.ok(items.some(item => item.name === 'Cooked prawns, or protein of choice'));
  assert.ok(items.some(item => item.name === 'Raw king prawns'));
  assert.equal(items.find(item => item.name === 'Butter').total,'60g + unmeasured');
  const rosemary = items.find(item => item.name === 'Rosemary');
  assert.equal(rosemary.sources.filter(source => source.slug === 'mrs-murrays-lasagne').length,1);
});

test('different units and size qualifiers are not silently converted', () => {
  const items = list([meal('boursin-salmon-traybake'),meal('blackened-fish-tacos'),meal('harissa-tuna-pitta'),meal('apricot-pepper-rice-sea-bass')]);
  assert.equal(items.find(item => item.name === 'Red onion').total, '1 + 1½ small + 20g');
  assert.equal(items.find(item => item.name === 'Olive oil').total, '3 tsp + unmeasured');
});

test('saved input is bounded and invalid or removed recipes cannot break planning', () => {
  const raw = {meals:[meal('missing'),{...meal('mrs-murrays-lasagne'),batches:100,day:'Bad day'},meal('mrs-murrays-lasagne'),null],includeOptional:'yes',checked:[]};
  const safe = normalizePlan(raw,recipes);
  assert.equal(safe.meals.length,1);
  assert.equal(safe.meals[0].batches,9);
  assert.equal(safe.meals[0].day,'Any day');
  assert.equal(safe.includeOptional,false);
  assert.deepEqual(safe.checked,{});
  assert.deepEqual(normalizePlan('broken',recipes).meals,[]);
});

test('quantity changes invalidate ticks and copied text retains original alternatives', () => {
  const meals = [meal('creamy-mushroom-pie')];
  const items = list(meals);
  const flour = items.find(item => item.name === 'Flour');
  const checked = {[flour.key]:flour.signature};
  const text = listAsText(recipes,meals,items,checked);
  assert.match(text,/\[x\] Flour — 60g/);
  assert.ok(text.includes('4 banana shallots or 2 onions'));
  assert.notEqual(list([meal('creamy-mushroom-pie',2)]).find(item => item.name === 'Flour').signature, flour.signature);
  assert.deepEqual(list([]),[]);
});
