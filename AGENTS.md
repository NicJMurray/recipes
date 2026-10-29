# Recipe collection instructions

- Work in `NicJMurray/recipes`; the homepage is a separate repository.
- Read `README.md`, `DEPLOYMENT.md`, and the recipe data before editing.
- Preserve the original settled recipe ingredients, amounts and method. Do not invent missing information or apply unconfirmed suggested revisions.
- Exclude Plan Three Meals, Core meals list and Food Ideas Notebook as recipe sources.
- Keep every recipe on its own address, with a normal link from the hub and a back link. Preserve working content without JavaScript.
- Keep external photos illustrative and credited; do not claim they show the exact recipe.
- Run `npm run build` and `npm run check` before pushing. Publish only `dist`, never the repository root.
- Commit and push changes to `main` for the connected Cloudflare Pages build. Verify the exact deployment commit and `recipes.njmurray.com` before claiming completion.
- Never commit credentials. The static app needs no environment secrets or database.
