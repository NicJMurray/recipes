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

Initialize `server/schema.sql` and `server/site-schema.sql` once before deploying. All statements are idempotent; the new site schema adds gallery and homepage tables without altering recipe data. Keep the database and secret across deployments. `recipes` stores published overrides and revisions; `recipe_versions` stores the last 30 previous versions. `recipe_photos` stores WebP blobs up to 1 MB each, below D1's row limit. This small collection uses D1 for media without requiring R2 activation. Monitor database storage as photos accumulate. Export/back up D1 before destructive migrations; the original seeds are still in Git.

Login rate limits: five failed attempts per IP per 15-minute window, twenty across the account per hour, eighty per day. Successful logins release their reservations. Sessions expire after seven days and logout revokes the current session. Credential changes should also revoke outstanding sessions. Origin checks restrict recipe mutation requests to the custom domain, including when the same build is accessible through pages.dev. Shared editing routes use the separate production-origin allowlist below.

Run build and checks, verify the exact Git deployment commit, then check the custom domain, session availability and login/editor flow. For local UI tests use only `npm run dev` and its disposable fixture login; never add a production bypass.


## Shared authentication

Keep the existing `ADMIN_AUTH`, `ADMIN_ORIGIN` and `RECIPES_DB` bindings. No authentication secret or session cookie is copied to photography or homepage. Those sites load the public `/shared-admin.js` module and `/shared-admin.css` stylesheet and call `/api/shared/session`, `/api/shared/login` and `/api/shared/logout` using `credentials: include`. Their Content Security Policy must allow the recipes origin for scripts, styles and connections. Public module and stylesheet responses allow credentialless cross-origin loading; authenticated API responses allow only the four named production origins.

The `__Host-recipe_admin` cookie retains `Path=/; HttpOnly; Secure; SameSite=Strict` and no Domain attribute. It continues working for existing recipe sessions. The shared APIs accept writes only on the canonical `ADMIN_ORIGIN` host and only from the explicit recipes, photography, apex or www origin. Never add wildcard subdomains or preview credentials to this allowlist. An authenticated UI is progressive enhancement; it must not gate public browsing.

## Website-wide editing and GitHub photographs

See [SHARED-EDITING.md](SHARED-EDITING.md) for the storage decision, secure one-time
`PHOTO_GITHUB_TOKEN` setup, additive `server/site-schema.sql` migration, reusable
client API and operational limits. No R2 subscription or new billing is required.

HQ uploads and exact-filename replacements add `gallery_media` and
`gallery_replacements` through that same idempotent schema file. Apply it before
deploying the new API, then deploy the photography frontend. Existing photo rows,
sessions, credentials and recipe data are preserved. Each new upload may include
960px/1920px files up to 2 MB each and a 3840px file up to 6 MB. Replacement media
gets a new immutable URL while the photo ID and published metadata stay unchanged.
