# Recipe collection instructions

- Work in `NicJMurray/recipes`; the homepage is a separate repository.
- Read `README.md`, `DEPLOYMENT.md`, and the recipe data before editing.
- Preserve the original settled recipe ingredients, amounts and method. Do not invent missing information or apply unconfirmed suggested revisions.
- Exclude Plan Three Meals, Core meals list and Food Ideas Notebook as recipe sources.
- Keep every recipe on its own address, with a normal link from the hub and a back link. Preserve working content without JavaScript.
- Keep external photos illustrative and credited; do not claim they show the exact recipe.
- Run `npm run build` and `npm run check` before pushing. Publish only `dist`, never the repository root.
- Commit and push changes to `main` for the connected Cloudflare Pages build. Verify the exact deployment commit and `recipes.njmurray.com` before claiming completion.
- Never commit credentials. The shared editor uses the existing RECIPES_DB binding and protected ADMIN_AUTH secret. Preserve both, and preserve saved overrides and photos across deployments.
- Original JSON recipes are seeds. D1 overrides take precedence after an owner saves an edit; do not silently replace or clear them. User edits made in the admin editor are explicitly authorized recipe revisions.
- Keep Published mode minimal. Editing controls, reorder handles and form fields belong in Edit mode. Drafts become public only through Save changes.
- Keep fixture authentication confined to the local test harness; never bundle it into production.
