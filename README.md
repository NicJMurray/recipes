# Nic’s recipe book

A minimalist, mobile-friendly recipe collection at **https://recipes.njmurray.com/**. A photo-led hub links to eleven individual recipe pages. Search by recipe or ingredient, filter by category or quick meals, tick off ingredients and print a cooking-friendly page.

## Content

`content/recipes.json` contains the recipes from the eleven Food-project chats shown in the supplied folder screenshot. `sourceChat` records the title. The excluded chats are **Plan Three Meals**, **Core meals list**, and **Food Ideas Notebook**.

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
- `scripts/build.mjs` — static HTML generator and Recipe structured data
- `scripts/check.mjs` — content coverage, output, links and structured-data checks
- `public/` — stylesheet, small progressive-enhancement script, favicon and response headers
- `dist/` — generated hub, individual recipe pages, credits, sitemap and 404 (not committed)

All content and links work without JavaScript. Search/filter controls and ingredient checkboxes are enhanced in the browser. Ingredient ticks are stored per recipe on the current browser; storage failure does not prevent cooking. There is no account, database or server API.

See `DEPLOYMENT.md` for the GitHub and Cloudflare deployment mapping. The homepage card and public catalog live separately in `NicJMurray/homepage`.
