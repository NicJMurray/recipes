import {STORAGE_KEY, CATEGORIES, DAYS, normalizePlan, buildShoppingList, listAsText} from './shopping-list.js';

const dataNode = document.getElementById('planner-data');
const data = JSON.parse(dataNode.textContent);
const recipes = data.recipes;
const lookup = new Map(recipes.map(recipe => [recipe.slug, recipe]));
const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let raw;
let storageAvailable = true;
try {raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');} catch {storageAvailable = false;}
let plan = normalizePlan(raw, recipes);
let shopping = [];
const newId = () => globalThis.crypto?.randomUUID?.() || `meal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const recipeLink = slug => `/recipes/${encodeURIComponent(slug)}/`;

function save() {
  try {localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));storageAvailable = true;} catch {storageAvailable = false;}
  $('plan-storage').textContent = storageAvailable ? 'Saved on this device.' : 'Your plan works here, but this browser cannot save it.';
}

let feedbackTimer;
function announce(message) {
  clearTimeout(feedbackTimer);
  $('planner-feedback').textContent = message;
  feedbackTimer = setTimeout(() => { $('planner-feedback').textContent = ''; }, 4500);
}

function updateProgress() {
  const count = shopping.filter(item => plan.checked[item.key] === item.signature).length;
  $('shopping-count').textContent = shopping.length ? `${count} of ${shopping.length} items ticked` : 'Your list will appear here.';
  $('clear-shopping-ticks').disabled = count === 0;
}

function render() {
  $('plan-count').textContent = `${plan.meals.length} meal${plan.meals.length === 1 ? '' : 's'}`;
  $('plan-empty').hidden = plan.meals.length !== 0;
  $('clear-plan').disabled = plan.meals.length === 0;
  $('planned-meals').innerHTML = plan.meals.map(meal => {
    const recipe = lookup.get(meal.slug);
    return `<li class="planned-meal" data-meal-id="${esc(meal.id)}"><div class="planned-info"><a href="${recipeLink(recipe.slug)}">${esc(recipe.title)}</a><p>${recipe.servings ? `Original recipe serves ${esc(recipe.servings)}` : 'Original recipe quantities'}</p></div><button class="remove-meal" type="button" data-remove="${esc(meal.id)}" aria-label="Remove ${esc(recipe.title)}">×</button><div class="meal-options"><label><span class="sr-only">Day for ${esc(recipe.title)}</span><select data-day="${esc(meal.id)}">${DAYS.map(day => `<option${day === meal.day ? ' selected' : ''}>${day}</option>`).join('')}</select></label><label class="batch-label"><span>Batches</span><select data-batches="${esc(meal.id)}" aria-label="Batches of ${esc(recipe.title)}">${Array.from({length:9},(_,i) => `<option value="${i+1}"${meal.batches === i+1 ? ' selected' : ''}>${i+1}</option>`).join('')}</select></label></div></li>`;
  }).join('');
  $('include-optional').checked = plan.includeOptional;
  shopping = buildShoppingList(recipes, data.mapping, plan.meals, plan.includeOptional);
  // Changed quantities must be checked again, even if that ingredient was previously ticked.
  plan.checked = Object.fromEntries(shopping.filter(item => plan.checked[item.key] === item.signature).map(item => [item.key, item.signature]));
  $('shopping-empty').hidden = shopping.length !== 0;
  $('shopping-groups').innerHTML = CATEGORIES.map(category => {
    const items = shopping.filter(item => item.category === category);
    if (!items.length) return '';
    return `<section class="shopping-group" aria-label="${esc(category)}"><h3>${esc(category)}</h3>${items.map(item => {
      const index = shopping.indexOf(item);
      return `<div class="shopping-item"><label class="shopping-check"><input type="checkbox" data-shopping="${index}"${plan.checked[item.key] === item.signature ? ' checked' : ''}><span class="checkmark" aria-hidden="true"></span><span><span class="shopping-name">${esc(item.name)}${item.optional ? '<small>optional</small>' : ''}</span>${item.total ? `<span class="shopping-amount">${esc(item.total)}</span>` : ''}</span></label><details class="shopping-sources"><summary>Recipe amounts <span aria-hidden="true">+</span></summary><ul>${item.sources.map(source => `<li><a href="${recipeLink(source.slug)}">${esc(source.title)}</a><span>${esc(source.original)}${source.batches > 1 ? ` <em>× ${source.batches} batches</em>` : ''}</span></li>`).join('')}</ul></details></div>`;
    }).join('')}</section>`;
  }).join('');
  for (const button of document.querySelectorAll('[data-add]')) {
    const count = plan.meals.filter(meal => meal.slug === button.dataset.add).length;
    button.querySelector('[data-added-count]').textContent = count ? `${count} in plan` : '';
    button.disabled = plan.meals.length >= 40;
  }
  $('copy-shopping').disabled = shopping.length === 0;
  $('print-shopping').disabled = shopping.length === 0;
  $('copy-fallback').hidden = true;
  updateProgress();
  save();
}

function add(slug) {
  if (!lookup.has(slug) || plan.meals.length >= 40) return;
  $('undo-clear').hidden = true;
  plan.meals.push({id: newId(), slug, day: 'Any day', batches: 1});
  render();
  announce(`${lookup.get(slug).title} added to your plan.`);
}

document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => add(button.dataset.add)));
$('planned-meals').addEventListener('click', event => {
  const button = event.target.closest('[data-remove]');
  if (!button) return;
  const index = plan.meals.findIndex(meal => meal.id === button.dataset.remove);
  const meal = plan.meals[index];
  if (!meal) return;
  plan.meals.splice(index, 1);
  render();
  const remaining = $('planned-meals').querySelectorAll('[data-remove]');
  (remaining[Math.min(index, remaining.length - 1)] || document.querySelector('[data-add]')).focus();
  announce(`${lookup.get(meal.slug).title} removed from your plan.`);
});
$('planned-meals').addEventListener('change', event => {
  const id = event.target.dataset.day || event.target.dataset.batches;
  const meal = plan.meals.find(meal => meal.id === id);
  if (!meal) return;
  if (event.target.dataset.day) {meal.day = event.target.value;save();return;}
  meal.batches = Number(event.target.value);
  render();
  document.querySelector(`[data-batches="${id}"]`).focus();
  announce('Shopping quantities updated.');
});
$('include-optional').addEventListener('change', event => {plan.includeOptional = event.target.checked;render();announce('Shopping list updated.');});
$('shopping-groups').addEventListener('change', event => {
  if (!event.target.matches('[data-shopping]')) return;
  const item = shopping[Number(event.target.dataset.shopping)];
  if (event.target.checked) plan.checked[item.key] = item.signature;
  else delete plan.checked[item.key];
  updateProgress();save();
});
$('clear-shopping-ticks').addEventListener('click', () => {plan.checked = {};render();$('shopping-heading').focus();announce('Shopping ticks cleared.');});
$('clear-plan').addEventListener('click', () => {
  const previous = JSON.stringify(plan);
  plan = normalizePlan(null, recipes);
  render();
  $('undo-clear').hidden = false;
  $('undo-clear').onclick = () => {plan = normalizePlan(JSON.parse(previous), recipes);render();$('undo-clear').hidden = true;announce('Plan restored.');};
  $('undo-clear').focus();
  announce('Plan cleared. You can undo this.');
});
$('copy-shopping').addEventListener('click', async () => {
  const text = listAsText(recipes, plan.meals, shopping, plan.checked);
  try {await navigator.clipboard.writeText(text);announce('Shopping list copied.');$('copy-shopping').textContent = 'Copied';setTimeout(() => {$('copy-shopping').textContent = 'Copy list';}, 1800);} catch {
    $('copy-fallback').hidden = false;$('shopping-text').value = text;$('shopping-text').focus();$('shopping-text').select();announce('Select and copy the list below.');
  }
});
$('print-shopping').addEventListener('click', () => window.print());
let printDetails = [];
window.addEventListener('beforeprint', () => {
  printDetails = [...document.querySelectorAll('.shopping-sources:not([open])')];
  printDetails.forEach(details => { details.open = true; });
});
window.addEventListener('afterprint', () => {
  printDetails.forEach(details => { details.open = false; });
  printDetails = [];
});
$('planner-search').addEventListener('input', event => {
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = normalize(event.target.value).trim().split(/\s+/).filter(Boolean);
  let visible = 0;
  document.querySelectorAll('[data-pick-recipe]').forEach(card => {card.hidden = !words.every(word => normalize(card.dataset.search).includes(word));if (!card.hidden) visible++;});
  $('picker-empty').hidden = visible !== 0;
});
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY) return;
  try {plan = normalizePlan(JSON.parse(event.newValue), recipes);render();announce('Plan updated from another tab.');} catch {}
});

const location = new URL(window.location.href);
const incoming = location.searchParams.get('add');
if (incoming) {
  location.searchParams.delete('add');
  history.replaceState(null, '', `${location.pathname}${location.search}${location.hash}`);
}
if (incoming && lookup.has(incoming)) add(incoming);
else render();
$('planner-app').hidden = false;
