# Shared website editing

The existing recipes Pages Worker is the small shared editing service for recipes,
photography and the homepage. Public sites stay public. Existing recipe credentials,
host-only HttpOnly session cookies, D1 recipe overrides and recipe uploads are unchanged.
There is no additional account or paid service to enable.

## Photography storage choice

New photographs use **GitHub**, as requested: two browser-generated WebP files are
committed to `NicJMurray/photography`, under `photos/uploads/<id>/`. Original JPEGs
never leave the browser. It reads the capture date, applies JPEG orientation, creates
960px and 1920px-wide versions without enlarging smaller sources, and removes image
metadata. The server checks sizes/dimensions and strips EXIF/XMP again before saving.
A batch processes sequentially to keep memory and API use bounded. Each rendition is
limited to 2 MB; JPEG input is limited to 40 MB and 80 megapixels.

GitHub works with the existing free repository and Cloudflare Pages integration,
without enabling R2 or billing. It creates a commit per photo and automatically
triggers the connected Pages build. The gallery can show new uploads immediately:
D1 stores only photo metadata, while a public media endpoint serves immutable GitHub
commit bytes until the Pages CDN has deployed them. Upload progress and local previews
appear in the browser; a failed upload is not reported as saved. No deployment token
is sent to the browser.

R2 would be a better fit for a large media library (object storage, no Git history
bloat, no build for uploads; current Standard free tier includes 10 GB and no egress
charges), but Cloudflare requires an R2 subscription checkout. **R2 is not used or
enabled here.** GitHub history grows even after photos are removed; review repository
size as the collection grows. Free service quotas still apply. Do not enable spending
or paid plans for this implementation.

The old gallery has no capture timestamps, so it retains natural filename order
(e.g. DSCF0477 before DSCF0509), and new camera-sequence filenames slot into it.
Capture dates from EXIF or date-shaped filenames are retained. When all visible photos
have dates, the gallery uses oldest-first capture-date order. Upload order is never
used as a claimed capture date.

Removing a photo hides it from the public gallery and disables the shared media URL.
The existing static originals and Git history remain recoverable; removal is not an
erasure of a publicly committed file. D1's metadata and hidden-ID records survive builds.

## One-time GitHub permission

Uploads require **one protected setting**. Use the account owner interface; never paste
a personal token into a chat, source file, build variable, browser localStorage or URL.

1. Open <https://github.com/settings/personal-access-tokens/new>.
2. Create a **fine-grained personal access token**, resource owner `NicJMurray`.
3. Under repository access choose **Only select repositories**, then **photography**.
4. Give **Repository permissions → Contents: Read and write**. Metadata read access is
   automatic. No account, organization, Actions, Workflows or other repository access
   is needed. Choose an expiry you are comfortable renewing.
5. In Cloudflare, open **Workers & Pages → recipes → Settings → Variables and Secrets**
   for **Production**. Add an **encrypted secret** named `PHOTO_GITHUB_TOKEN` with the
   token value. Do not replace `ADMIN_AUTH`, `ADMIN_ORIGIN`, `NODE_VERSION` or `RECIPES_DB`.
6. Redeploy the latest `recipes` production deployment so it receives the new secret.
7. Visit <https://photography.njmurray.com/>, use the small **Log in** control with the
   existing recipe credentials, and choose **Upload photos**. A login at recipes or
   the homepage also works; return to an already open tab to refresh its session.

The API writes only predetermined image paths on photography's `main` branch; it uses
optimistic, non-force Git ref updates and retries concurrent commits without replacing
other work. If the token expires/revokes, login and text editing continue; new photo
uploads explain the missing storage permission. Renew only this secret and redeploy.

Cloudflare project link:
<https://dash.cloudflare.com/22c1482ec05957092be7a2df424c4543/pages/view/recipes/settings>

## Database and deployment

Run the additive `server/site-schema.sql` migration against the existing
`RECIPES_DB` (`recipes-editor`, `be986588-607a-49d3-a20f-942813a3ffbf`). It creates
`gallery_photos`, `gallery_hidden` and `site_content`, without changing recipe tables,
credentials or sessions. Do not reset the database or copy seed recipes over saved edits.

Build and check recipes; push all three repositories to their existing `main` branches.
Their existing Git-connected Cloudflare builds publish `dist` only. No additional
Cloudflare bindings, accounts, deploy keys, Actions workflows or API tokens are needed
apart from the narrowly scoped image-storage secret above.

## Reusing the editor

`https://recipes.njmurray.com/shared-admin.js` exports:

- `mountAdmin({container,onSessionChange})`: minimal login/logout dialog and controls;
  returns `ready`, `refresh()` and `openLogin()`.
- `getSession()`: the current shared session.
- `request('/api/shared/...', {method,body})`: credentialed requests; object bodies
  become JSON and `FormData` passes through. Errors include HTTP `status`.

Load `shared-admin.css` alongside the module. Cookies stay exclusively on the recipes
host; HTTPS subdomains are same-site, and other websites call its allowlisted API.
Only exact production origins (recipes, photography, apex and www) may authenticate or
write. Untrusted domains and Pages previews cannot edit production. Existing recipe
write routes still require the recipes origin. Public API reads expose only published
content, never credentials or sessions. Login is rate limited and lasts seven days;
logging out revokes the same session everywhere.

The homepage attaches stable `data-content-key` values to its section headings and
project descriptions. It reads `/api/shared/content/homepage`, edits plain text, and
saves with a revision check. HTML is never accepted as executable content. Save failures
preserve drafts; Cancel restores published text. Adding other editable text needs stable
keys plus a server allowlist; future image/project editors can reuse the same login and
API helpers without introducing a CMS. Existing static content remains a fallback if
JavaScript or the shared service is unavailable.

## Validation

`npm run build && npm run check` in recipes covers its existing recipe/planner behavior,
shared sessions/origins and content API behavior using disposable local fixtures.
Photography's pure processing tests cover EXIF/filename dates, ordering, malformed
metadata and metadata stripping. Browser checks cover conversion, multi-upload, saved
and failed previews, deletion and homepage save/cancel/conflict behavior. Production
upload validation requires the owner's protected GitHub setting; no fixture credentials
or test bypass is deployed.
