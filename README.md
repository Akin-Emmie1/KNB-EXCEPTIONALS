# KNB EXCEPTIONALS

Vanilla HTML/CSS/JavaScript storefront and admin dashboard, hosted on Cloudflare Pages and backed by a Cloudflare Worker API and the existing D1 database. Product and salon service images are static website assets; this project does not use R2.

## Architecture

- **GitHub:** source-code repository and deployment source for Cloudflare Pages.
- **Cloudflare Pages:** serves `index.html`, `admin.html`, and the static image files committed with the site.
- **Cloudflare Worker:** serves the `/api/*` backend.
- **Cloudflare D1:** existing database, bound as `DB` in `wrangler.toml`:
  - Database: `knb-enterprise-db`
  - ID: `278d5dc9-f097-4094-91e2-6718ace14daa`
- The database schema has already been applied manually. Do not rerun or reapply `migrations/0001_initial.sql`.

No R2 bucket, payment provider, or other paid service is required by this configuration.

## Cloudflare configuration and routing

1. Install Node.js and Wrangler locally, then authenticate:

   ```powershell
   npm install --save-dev wrangler
   npx wrangler login
   ```

2. Confirm the existing D1 database binding in `wrangler.toml`. The Worker must use the existing `DB` binding and the database name and ID listed above. Do not create a replacement database or run a migration.

3. Configure the Cloudflare Pages project to deploy the repository’s static site files. The repository root contains the HTML pages and image assets; do not configure a build step that omits those assets.

4. Configure the Worker route for the Pages site’s **custom domain** so requests to `https://<site-domain>/api/*` reach this Worker with the `/api` path preserved. The admin and storefront both use the same-origin `/api` base. A custom-domain route keeps the admin session cookie on the site host. The Pages `pages.dev` preview hostname is not automatically covered by a custom-domain Worker route; use an appropriate preview setup rather than assuming the production route applies there.

5. If the site and API are intentionally served from different origins, set the Worker’s `ALLOWED_ORIGINS` variable to the exact storefront origin and configure the frontend API base accordingly. Cross-origin admin sessions may be restricted by browser cookie policies; same-origin routing is preferred.

6. Deploy the Worker only after verifying the D1 binding and route:

   ```powershell
   npx wrangler deploy
   ```

   Then verify `https://<site-domain>/api/health` returns `{"status":"ok"}`. This repository does not contain the production domain or a hosting-provider route configuration, so the route must be set in the Cloudflare dashboard for the actual domain.

## Admin authentication

The Worker retains server-side PBKDF2 password verification and D1-backed hashed sessions. Do not place administrator credentials in frontend files.

For initial setup, generate the password hash locally and set the one-time bootstrap values as Worker secrets:

```powershell
node scripts/hash-password.mjs
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD_HASH
```

Provide the chosen administrator email and generated hash only at the prompts. After the first successful admin sign-in creates the D1 admin account, remove the bootstrap secrets:

```powershell
npx wrangler secret delete ADMIN_EMAIL
npx wrangler secret delete ADMIN_PASSWORD_HASH
```

## Static image workflow

1. Add each approved product or salon service image file to the website repository so Cloudflare Pages publishes it.
2. In Admin, enter the image’s **root-relative** website path, such as `/images/<actual-file-name>.jpg`. Use the real path and filename that exist in the deployed site; examples are placeholders, not supplied assets.
3. For product galleries, enter one root-relative path per line. Leave image fields blank when there is no image.
4. Save the product or service. The Worker validates that image paths are root-relative, contain no traversal segments, and end in `.jpg`, `.jpeg`, `.png`, or `.webp`; it stores them in the existing D1 image columns and returns those paths to the storefront.
5. To replace or remove an image, update or clear its path in Admin and save. Add or remove the corresponding static asset in the website repository as needed.

File uploads are disabled; the `/api/admin/images` route remains present but responds that uploads are unavailable. The legacy `/api/media/*` route does not serve R2 files. Existing D1 R2 object keys will not display as static images; replace those references with verified static paths in Admin. No image filename or database record is assumed by this guide.

## Application behavior

- D1 stores product and category data, salon services and settings, administrator accounts and sessions, and appointments.
- Public bookings are pending until an administrator confirms them. Pending and confirmed appointments reserve the schedule; cancelled appointments release it. Salon time calculations use the configured timezone, initially `Africa/Lagos`.
- The opening-hours schedule starts empty (closed). Configure the actual schedule in Admin before accepting bookings.
- Checkout remains a WhatsApp enquiry. No payment processing or stored order system is configured.
- The Worker and frontend do not use Supabase.

## Local API development

Run the Worker locally with Wrangler after confirming your local D1 access and secrets:

```powershell
npx wrangler dev
```

When serving the static site from a different local origin, configure `apiBaseUrl` in the existing `window.KMB_CONFIG` script on both pages and set `ALLOWED_ORIGINS` to that exact origin. `KMB_CONFIG` is a legacy technical configuration key, not a business-brand reference. Never put administrator passwords or Cloudflare credentials in the HTML.
