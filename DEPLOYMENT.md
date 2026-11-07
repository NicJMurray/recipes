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

The site uses the existing Cloudflare GitHub authorization and Pages build path, as the housing simulator does. This is a static-app exception to the homepage development guide’s preference for new Workers with Static Assets: the Pages integration can publish without inspecting or creating deployment credentials for Workers Builds. The requested shared editor now uses an advanced-mode Pages Worker; the existing Git integration remains in place.

Push checked source to `main`; the Git-connected Pages project builds and publishes automatically. Verify Cloudflare’s deployment is successful for that commit and the custom domain serves the new content through normal DNS. A manual upload alone does not prove Git deployment works.

Add the custom domain to the Pages project and create a proxied CNAME to the **server-returned Pages subdomain**. Do not guess a globally unique `pages.dev` hostname. Wait for domain validation and certificate activation.

Only generated `dist/` is public. Source chat titles are kept in the data for provenance, while no chat links, messages or personal profile information are published. Photography is served directly by the Unsplash CDN at responsive sizes, with photographer credits linked from each recipe page. If the external CDN is unavailable, recipe content and navigation remain usable.

`/meal-planner/` is part of the same static build and sitemap. Its public data contains recipe ingredients and shopping mappings, without source-chat titles. The planner uses the current D1-backed recipe catalog; personal plans still stay in the browser. Personal plans live only in browser localStorage. The planner scripts revalidate on refresh; the page includes a versioned entry script.

The `Food` section, `Recipes` card and matching public catalog entry belong in `NicJMurray/homepage`. Do not copy this application into that repository.


## Editor backend

The build includes `dist/_worker.js` and `_routes.json`. Public HTML is rendered with the same renderer as the static fallback, merging D1 overrides onto the seed catalog. Unrelated assets are served directly by Pages. Do not publish the repository root or deploy without the bindings below. HTML and API responses use no-store so saved changes appear on refresh; scripts revalidate and have content-versioned URLs.

Production bindings:

- `RECIPES_DB`: D1 database `recipes-editor`, ID `be986588-607a-49d3-a20f-942813a3ffbf`.
- `ADMIN_AUTH`: encrypted `secret_text` containing `{username,salt,iterations,hash}`. Salt is 24 random bytes as hex. Hash is PBKDF2-SHA256, 100,000 iterations, 256 bits over lowercase username + newline + passphrase. Provision through a trusted administrative path; never commit the secret or the passphrase.
- `ADMIN_ORIGIN`: `https://recipes.njmurray.com`.
- Preserve `NODE_VERSION`. No preview credentials or fixture sessions are accepted in production. Read replication stays disabled for immediate read-after-write consistency.

Initialize `server/schema.sql` once before deploying. All statements are idempotent. Keep the database and secret across deployments. `recipes` stores published overrides and revisions; `recipe_versions` stores the last 30 previous versions. `recipe_photos` stores WebP blobs up to 1 MB each, below D1's row limit. This small collection uses D1 for media without requiring R2 activation. Monitor database storage as photos accumulate. Export/back up D1 before destructive migrations; the original seeds are still in Git.

Login rate limits: five failed attempts per IP per 15-minute window, twenty across the account per hour, eighty per day. Successful logins release their reservations. Sessions expire after seven days and logout revokes the current session. Credential changes should also revoke outstanding sessions. Origin checks restrict mutation requests to the custom domain, including when the same build is accessible through pages.dev.

Run build and checks, verify the exact Git deployment commit, then check the custom domain, session availability and login/editor flow. For local UI tests use only `npm run dev` and its disposable fixture login; never add a production bypass.
