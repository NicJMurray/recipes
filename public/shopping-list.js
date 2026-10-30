export const STORAGE_KEY = 'njmurray-recipes:meal-plan:v1';
export const CATEGORIES = ['Fruit & vegetables', 'Fish & seafood', 'Dairy & eggs', 'Bread & pastry', 'Cupboard', 'Other'];
export const DAYS = ['Any day', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function normalizePlan(raw, recipes) {
  const valid = new Set(recipes.map(recipe => recipe.slug));
  const seen = new Set();
  const meals = [];
  for (const meal of Array.isArray(raw?.meals) ? raw.meals.slice(0, 40) : []) {
    if (!meal || !valid.has(meal.slug) || typeof meal.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(meal.id) || seen.has(meal.id)) continue;
    seen.add(meal.id);
    meals.push({id: meal.id, slug: meal.slug, day: DAYS.includes(meal.day) ? meal.day : 'Any day', batches: Math.min(9, Math.max(1, Math.trunc(Number(meal.batches)) || 1))});
  }
  return {meals, includeOptional: raw?.includeOptional === true, checked: raw?.checked && typeof raw.checked === 'object' && !Array.isArray(raw.checked) ? Object.fromEntries(Object.entries(raw.checked).filter(([key,value]) => key.length < 200 && typeof value === 'string' && value.length < 20000)) : {}};
}

export function formatNumber(number) {
  const rounded = Math.round(number * 1000) / 1000;
  const whole = Math.floor(rounded);
  const fraction = Math.round((rounded - whole) * 1000) / 1000;
  const symbol = new Map([[0.25, '¼'], [0.5, '½'], [0.75, '¾']]).get(fraction);
  return symbol ? `${whole || ''}${symbol}` : String(rounded);
}

function amountLabel(amount) {
  const number = amount.min === amount.max ? formatNumber(amount.min) : `${formatNumber(amount.min)}–${formatNumber(amount.max)}`;
  return `${number}${['g','ml'].includes(amount.unit) ? '' : amount.unit ? ' ' : ''}${amount.unit}`;
}

export function buildShoppingList(recipes, mapping, meals, includeOptional = false) {
  const bySlug = new Map(recipes.map(recipe => [recipe.slug, recipe]));
  const batches = new Map();
  for (const meal of meals) if (bySlug.has(meal.slug)) batches.set(meal.slug, (batches.get(meal.slug) || 0) + meal.batches);
  const items = new Map();
  for (const [slug, multiplier] of batches) {
    const recipe = bySlug.get(slug);
    const used = new Set();
    for (const group of recipe.ingredients) {
      for (const original of group.items) {
        const optional = /^optional\b/i.test(group.title) || /\(optional\)/i.test(original);
        if (optional && !includeOptional) continue;
        // An unmeasured ingredient repeated in different stages is still one purchase.
        const entries = mapping[original] || [{name: original, category: 'Other', quantity: null}];
        for (const entry of entries) {
          const key = `${entry.category}:${entry.name}`;
          const sourceKey = `${key}:${original}`;
          if (used.has(sourceKey) && !entry.quantity) continue;
          used.add(sourceKey);
          if (!items.has(key)) items.set(key, {key, name: entry.name, category: entry.category, quantities: new Map(), unmeasured: false, optional: true, sources: []});
          const item = items.get(key);
          item.optional &&= optional;
          item.sources.push({slug, title: recipe.title, original, batches: multiplier, optional});
          if (entry.quantity) {
            const q = entry.quantity;
            if (!item.quantities.has(q.unit)) item.quantities.set(q.unit, {min: 0, max: 0, unit: q.unit});
            const total = item.quantities.get(q.unit);
            total.min += q.min * multiplier;
            total.max += q.max * multiplier;
          } else item.unmeasured = true;
        }
      }
    }
  }
  return [...items.values()].map(item => {
    const amounts = [...item.quantities.values()].map(amountLabel);
    const total = amounts.length ? `${amounts.join(' + ')}${item.unmeasured ? ' + unmeasured' : ''}` : '';
    const sources = item.sources.sort((a,b) => a.slug.localeCompare(b.slug) || a.original.localeCompare(b.original));
    return {key: item.key, name: item.name, category: item.category, total, optional: item.optional, sources, signature: JSON.stringify(sources)};
  }).sort((a,b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name, 'en-GB'));
}

export function listAsText(recipes, meals, items, checked) {
  const lookup = new Map(recipes.map(recipe => [recipe.slug, recipe]));
  const lines = ['THIS WEEK’S MEALS', ...meals.map(meal => `${meal.day}: ${lookup.get(meal.slug).title}${meal.batches > 1 ? ` (${meal.batches} batches)` : ''}`), '', 'SHOPPING LIST'];
  let category = '';
  for (const item of items) {
    if (category !== item.category) {category = item.category; lines.push('', category);}
    const tick = checked[item.key] === item.signature ? 'x' : ' ';
    lines.push(`[${tick}] ${item.name}${item.total ? ` — ${item.total}` : ''}${item.optional ? ' (optional)' : ''}`);
    for (const source of item.sources) lines.push(`    ${source.title}: ${source.original}${source.batches > 1 ? ` [original amount × ${source.batches}]` : ''}`);
  }
  return lines.join('\n');
}
