import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const recipes = JSON.parse(await readFile(path.join(root, 'content/recipes.json'), 'utf8'));
const photos = JSON.parse(await readFile(path.join(root, 'content/photos.json'), 'utf8'));
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url = recipe => `/recipes/${recipe.slug}/`;
const imageUrl = (photo, width) => `https://images.unsplash.com/${photo.id}?auto=format&fit=crop&w=${width}&q=80`;
const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const plate = '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="10" stroke="currentColor" stroke-width="1.3"/><circle cx="20" cy="20" r="6.5" stroke="currentColor" stroke-width="1"/><path d="M4 7v7m3-7v7m-6-7v7c0 4 6 4 6 0M4 17v16M35 7c-4 3-4 12 0 12V7Zm0 12v14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function photoMarkup(recipe, {hero = false, eager = false} = {}) {
  const photo = photos[recipe.imageKey];
  return `<img src="${imageUrl(photo, hero ? 1600 : 720)}" srcset="${[480,720,1100,1600].map(w=>`${imageUrl(photo,w)} ${w}w`).join(', ')}" sizes="${hero ? '(max-width: 760px) 100vw, 1120px' : '(max-width: 600px) 100vw, (max-width: 960px) 50vw, 380px'}" width="${hero?1600:720}" height="${hero?900:540}" alt="${esc(photo.alt)}" ${eager?'fetchpriority="high"':'loading="lazy"'} decoding="async">`;
}

function card(recipe, index, related = false) {
  const keywords = [recipe.title, recipe.description, recipe.category, ...recipe.tags, ...recipe.ingredients.flatMap(g => g.items)].join(' ').toLowerCase();
  return `<article class="recipe-card" ${related ? '' : `data-recipe data-category="${esc(recipe.category)}" data-quick="${Boolean(recipe.totalMinutes && recipe.totalMinutes<=20)}" data-search="${esc(keywords)}"`}>
    <a class="card-photo" href="${url(recipe)}" tabindex="-1" aria-hidden="true">${photoMarkup(recipe,{eager:index<3})}<span class="photo-arrow">${arrow}</span></a>
    <div class="card-meta"><span>${esc(recipe.category)}</span><span>${esc(recipe.timeLabel || '')}</span></div>
    <h2><a href="${url(recipe)}">${esc(recipe.title)}</a></h2>
    <p>${esc(recipe.description)}</p>
  </article>`;
}

function layout({title, description, body, slug = '', schema = null}) {
  const canonical = `https://recipes.njmurray.com/${slug ? `recipes/${slug}/` : ''}`;
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Nic’s recipe book</title><meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#f8f7f2"><link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="${slug?'article':'website'}"><meta property="og:url" content="${canonical}">
<meta property="og:image" content="${imageUrl(photos[recipes.find(r=>r.slug===slug)?.imageKey || 'salmon'],1200)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="preconnect" href="https://images.unsplash.com">
<link rel="stylesheet" href="/style.css"><script defer src="/app.js"></script>${schema?`<script type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script>`:''}
</head><body><a class="skip" href="#main">Skip to content</a>
<header class="site-header wrap"><a class="wordmark" href="/">${plate}<span>Nic’s <em>recipe book</em></span></a><nav aria-label="Main"><a href="/" ${slug?'':'aria-current="page"'}>The recipes</a><a href="https://njmurray.com/">njmurray ${arrow}</a></nav></header>
${body}
<footer class="site-footer wrap"><a class="footer-brand" href="/">Good food, made again.</a><p>A personal collection by <a href="https://njmurray.com/">Nic Murray</a>.</p><span class="photo-note">Illustrative photography from <a href="/photography-credits/">Unsplash</a>.</span></footer>
</body></html>`;
}

const hub = layout({title:'A few good recipes',description:'A personal recipe collection: simple lunches, proper dinners, and the ones worth making again.',body:`
<main id="main" class="wrap">
  <section class="collection" aria-label="Recipe collection"><div class="collection-tools"><div class="filters" role="group" aria-label="Filter recipes"><button type="button" class="filter active" data-filter="all" aria-pressed="true">All recipes</button><button type="button" class="filter" data-filter="Fish & seafood" aria-pressed="false">Fish & seafood</button><button type="button" class="filter" data-filter="Vegetarian" aria-pressed="false">Vegetarian</button><button type="button" class="filter" data-filter="quick" aria-pressed="false">20 minutes & under</button></div><label class="search"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6" stroke="currentColor" stroke-width="1.5"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span class="sr-only">Search recipes or ingredients</span><input type="search" id="recipe-search" aria-label="Search recipes or ingredients" placeholder="Find a recipe or ingredient…" autocomplete="off"><button type="button" id="clear-search" aria-label="Clear search" hidden>×</button></label></div>
  <div class="collection-label"><span id="result-count" role="status" aria-live="polite">${recipes.length} recipes</span><span>A RECIPE FOR EVERY KIND OF DAY</span></div>
  <div class="recipe-grid" id="recipe-grid">${recipes.map((r,i)=>card(r,i)).join('\n')}</div><div class="empty-state" id="empty-state" hidden><h2>Nothing in the cupboard.</h2><p>Try another ingredient or explore the full collection.</p><button type="button" id="reset-filters">Show all recipes ${arrow}</button></div></section>
</main>`});

function recipePage(recipe) {
  const photo = photos[recipe.imageKey];
  let ingredientIndex=0;
  const ingredients = recipe.ingredients.map(group=>`<fieldset><legend>${esc(group.title)}</legend>${group.items.map(item=>`<label class="ingredient"><input type="checkbox" data-ingredient="${ingredientIndex++}"><span class="checkmark" aria-hidden="true"></span><span>${esc(item)}</span></label>`).join('')}</fieldset>`).join('');
  const related = recipes.filter(r=>r.slug!==recipe.slug && r.category===recipe.category).slice(0,3);
  const schema = {'@context':'https://schema.org','@type':'Recipe',name:recipe.title,description:recipe.description,image:imageUrl(photo,1600),...(recipe.servings?{recipeYield:recipe.servings}:{}),recipeIngredient:recipe.ingredients.flatMap(g=>g.items),recipeInstructions:recipe.steps.map(s=>({'@type':'HowToStep',name:s.title,text:s.text})),recipeCategory:recipe.category};
  return layout({title:recipe.title,description:recipe.description,slug:recipe.slug,schema,body:`
<main id="main" class="wrap recipe-page" data-slug="${esc(recipe.slug)}"><a class="back-link" href="/">${arrow} All recipes</a>
<section class="recipe-intro"><p class="eyebrow">${esc(recipe.category)} <span> / </span> ${esc(recipe.tags.join(' · '))}</p><h1>${esc(recipe.title)}</h1><p class="recipe-description">${esc(recipe.description)}</p><dl class="recipe-facts">${recipe.servings?`<div><dt>Serves</dt><dd>${esc(recipe.servings)}</dd></div>`:''}${recipe.prep?`<div><dt>Prep</dt><dd>${esc(recipe.prep)}</dd></div>`:''}${recipe.cook?`<div><dt>Cook</dt><dd>${esc(recipe.cook)}</dd></div>`:!recipe.prep?`<div><dt>Time</dt><dd>${esc(recipe.timeLabel)}</dd></div>`:''}${recipe.temperature?`<div><dt>Oven</dt><dd>${esc(recipe.temperature)}</dd></div>`:''}</dl></section>
<figure class="recipe-hero">${photoMarkup(recipe,{hero:true,eager:true})}<figcaption>Illustrative photograph · <a href="${esc(photo.page)}" target="_blank" rel="noopener noreferrer">${esc(photo.by)} / Unsplash</a></figcaption></figure>
<div class="recipe-actions"><div><a href="#ingredients">Ingredients</a><a href="#method">Method ${arrow}</a></div><button type="button" id="print-recipe"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>Print recipe</button></div>
<div class="recipe-body"><aside class="ingredients" id="ingredients"><div class="ingredient-heading"><h2>Ingredients</h2><button type="button" id="reset-ingredients">Clear ticks</button></div><p class="helper">Tick things off as you go.</p><form aria-label="Ingredient checklist">${ingredients}</form><p class="checklist-feedback sr-only" aria-live="polite"></p></aside>
<section class="method" id="method" aria-labelledby="method-title"><p class="eyebrow">LET’S MAKE IT</p><h2 id="method-title">The method</h2><ol>${recipe.steps.map((step,i)=>`<li><span class="step-number" aria-hidden="true">${String(i+1).padStart(2,'0')}</span><div><h3>${esc(step.title)}</h3><p>${esc(step.text)}</p></div></li>`).join('')}</ol>${recipe.notes?.length?`<div class="recipe-notes"><h3>A note from the recipe book</h3>${recipe.notes.map(n=>`<p>${esc(n)}</p>`).join('')}</div>`:''}</section></div>
<section class="related" aria-labelledby="related-heading"><div class="related-heading"><h2 id="related-heading">Something for next time.</h2><a href="/">All recipes ${arrow}</a></div><div class="recipe-grid">${related.map((r,i)=>card(r,i,true)).join('')}</div></section></main>`});
}

await rm(out, {recursive:true,force:true});
await mkdir(out,{recursive:true});
await cp(path.join(root,'public'),out,{recursive:true});
await writeFile(path.join(out,'index.html'),hub);
for (const recipe of recipes) {const dir=path.join(out,'recipes',recipe.slug);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'index.html'),recipePage(recipe));}
const credits = layout({title:'Photography credits',description:'The photographers behind the illustrative images in Nic’s recipe book.',body:`<main id="main" class="wrap credits-page"><a class="back-link" href="/">${arrow} All recipes</a><p class="eyebrow">BEHIND THE PICTURES</p><h1>Photography.</h1><p class="recipe-description">These photographs show related dishes and ingredients. They are illustrative, rather than photographs of these exact recipes.</p><div class="credits-list">${Object.values(photos).map(p=>`<div><h2>${esc(p.alt)}</h2><a href="${esc(p.page)}" target="_blank" rel="noopener noreferrer">${esc(p.by)} on Unsplash ${arrow}</a></div>`).join('')}</div><p>All selected photographs are available under the <a href="https://unsplash.com/license">Unsplash License</a>.</p></main>`});
await mkdir(path.join(out,'photography-credits'),{recursive:true});await writeFile(path.join(out,'photography-credits/index.html'),credits);
await writeFile(path.join(out,'404.html'),layout({title:'Recipe not found',description:'Find your way back to the recipe collection.',body:`<main id="main" class="wrap not-found"><p class="eyebrow">404</p><h1>Lost in the kitchen?</h1><p>That recipe isn’t here.</p><a href="/">Back to all recipes ${arrow}</a></main>`}));
await writeFile(path.join(out,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/',...recipes.map(url),'/photography-credits/'].map(p=>`<url><loc>https://recipes.njmurray.com${p}</loc></url>`).join('')}</urlset>`);
console.log(`Built hub, ${recipes.length} recipe pages, photography credits and 404 page.`);
