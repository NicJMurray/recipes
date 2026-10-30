# Deployment

- GitHub: `NicJMurray/recipes`
- Production branch: `main`
- Cloudflare Pages project: `recipes`
- Pages project ID: `d1819767-aade-44a5-8937-b554e98ecf02`
- Pages hostname: `recipes-3tk.pages.dev`
- Build command: `npm run build && npm run check`
- Build output: `dist`
- Root directory: repository root
- Node version: 22 or later
- Custom domain: `recipes.njmurray.com`

The site uses the existing Cloudflare GitHub authorization and Pages build path, as the housing simulator does. This is a static-app exception to the homepage development guide’s preference for new Workers with Static Assets: the Pages integration can publish without inspecting or creating deployment credentials for Workers Builds. The app has no server functionality.

Push checked source to `main`; the Git-connected Pages project builds and publishes automatically. Verify Cloudflare’s deployment is successful for that commit and the custom domain serves the new content through normal DNS. A manual upload alone does not prove Git deployment works.

Add the custom domain to the Pages project and create a proxied CNAME to the **server-returned Pages subdomain**. Do not guess a globally unique `pages.dev` hostname. Wait for domain validation and certificate activation.

Only generated `dist/` is public. Source chat titles are kept in the data for provenance, while no chat links, messages or personal profile information are published. Photography is served directly by the Unsplash CDN at responsive sizes, with photographer credits linked from each recipe page. If the external CDN is unavailable, recipe content and navigation remain usable.

`/meal-planner/` is part of the same static build and sitemap. Its public data contains recipe ingredients and shopping mappings, without source-chat titles. No new backend, environment binding, subscription or external API is required. Personal plans live only in browser localStorage. The planner scripts revalidate on refresh; the page includes a versioned entry script.

The `Food` section, `Recipes` card and matching public catalog entry belong in `NicJMurray/homepage`. Do not copy this application into that repository.

