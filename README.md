# Nic’s recipe book

A minimalist, mobile-friendly recipe collection at **https://recipes.njmurray.com/**. A photo-led hub links to individual recipe pages. Search by recipe or ingredient, filter by category or quick meals, tick off ingredients and print a cooking-friendly page.

The **[meal planner](https://recipes.njmurray.com/meal-planner/)** lets visitors choose recipes, assign optional weekdays, cook one or more batches and make a single shopping list. Add meals from the planner or use “Plan this meal” on a recipe page. The same recipe can be planned more than once. Plans and shopping ticks stay in the current browser; there is no account or cross-device sync. Copy and print work without any server API.

Shopping totals combine only explicitly recorded amounts with matching units and size qualifiers. Ranges remain ranges; alternatives, heaped measures, different preparations and unmeasured amounts are preserved. Optional ingredients are excluded until “Include optional extras” is selected. Every shopping item exposes its exact original ingredient lines and recipe links. A batch multiplies the original recipe rather than inferring a serving count. Changed quantities clear the affected shopping ticks. `content/shopping.json` maps original ingredient lines to shopping names and explicit quantities; update that mapping alongside any new ingredient, without changing the source recipe to fit the planner.

## Content

`content/recipes.json` contains the recipes from the original Food-project recipe chats plus later additions explicitly requested by the owner. `sourceChat` records the title. The excluded chats are **Plan Three Meals**, **Core meals list**, and **Food Ideas Notebook**.

Preserve the latest settled version within each original chat. Keep informal amounts, ranges, alternatives and unspecified measurements as written. Do not generate missing quantities, timings, temperatures, servings, nutritional values or substitutions. The whole-milk mushroom pie keeps its original amounts; unadopted audit suggestions are not recipe changes. Cooking headings and descriptions organize the recovered content without adding cooking instructions. Chat text was recovered through history search rather than a complete chat export.

Photos are illustrative stock images of related dishes or ingredients, **not photos of these exact recipes**. `content/photos.json` records the photographer, original Unsplash photo page and CDN asset. Credit is shown on the recipe page and at `/photography-credits/`.

## Run

Requires Node.js 22 or later. There are no installed dependencies.

```sh
npm run build
npm run check
```

`scripts/build.mjs` generates only public files in `dist/`. Serve that folder for local development. On the managed preview service, `.openai/hosting.json` selects `dist`; that local preview setting is not committed.

## Structure

- `content/recipes.json` — titles, original quantities, instructions and source-chat names
- `content/photos.json` — illustrative photography and credits
- `content/shopping.json` — shopping groups and explicitly recorded quantities, keyed by original ingredient wording
- `scripts/build.mjs` — static HTML generator and Recipe structured data
- `scripts/check.mjs` — content coverage, output, links and structured-data checks
- `public/` — stylesheet, small progressive-enhancement script, favicon and response headers
- `public/planner.js`, `public/shopping-list.js` — browser meal planning and pure shopping-list calculation
- `test/shopping-list.test.mjs` — original ingredient coverage, aggregation, alternatives, optional extras, repeat cooking and saved-state checks
- `dist/` — generated hub, individual recipe pages, credits, sitemap and 404 (not committed)

All content and links work without JavaScript. Search/filter controls and ingredient checkboxes are enhanced in the browser. Ingredient ticks are stored per recipe on the current browser; storage failure does not prevent cooking. There is no account, database or server API.

The interactive meal planner needs JavaScript; the original recipe pages remain readable without it. If browser storage is unavailable, planning still works for the open page and shows that the plan cannot be saved. Clipboard failures show a selectable text fallback.

See `DEPLOYMENT.md` for the GitHub and Cloudflare deployment mapping. The homepage card and public catalog live separately in `NicJMurray/homepage`.


Mrs Murray's Lasagne uses the 30 October 2026 transcript and accompanying ingredient screenshot, with courgette omitted as requested. The text-free page ending keeps an 80px empty spacer after the page content; removed introduction and footer copy should stay removed.


The stylesheet URL includes a build-time content hash so published spacing changes are picked up on refresh.

Mrs Murray's Lasagne uses a locally hosted AI-generated vegetarian lasagne illustration, labelled as illustrative. Stock-photo credits remain on the other recipes.

