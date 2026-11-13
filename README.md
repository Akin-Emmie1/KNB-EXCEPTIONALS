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

Admin access uses Google OAuth and only accepts the verified Google account `iderakayode@gmail.com`. Authentication does not query D1; D1 remains in use for business data. The Worker issues an eight-hour, signed, secure, HTTP-only session cookie.

Before deploying the Worker:

1. In Google Cloud Console, configure an OAuth consent screen and add `iderakayode@gmail.com` as an allowed test user (or publish the app as appropriate).
2. Create a **Web application** OAuth client and add this exact authorized redirect URI: `https://knb-exceptional.vercel.app/api/admin/auth/google/callback`.
3. Configure `GOOGLE_CLIENT_ID` as a Worker variable. Set `GOOGLE_CLIENT_SECRET` and a randomly generated `ADMIN_SESSION_SECRET` (at least 32 characters) as Worker secrets. Never put secrets in this repository.
4. Deploy the Worker and site. Open `/admin.html` and select **Continue with Google**.

Set the secrets with Wrangler if preferred:

```powershell
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put ADMIN_SESSION_SECRET
```

## Product image uploads

The Admin product form can attach a main image and multiple gallery images from the device. The authenticated Worker commits image files into the existing GitHub website repository under `images/`; the normal website deployment then publishes those static files. Image binaries are not stored in D1 or R2. The existing image-path fields remain available for assets already deployed with the site.

Before using the attach buttons:

1. Set the Worker variable `GITHUB_REPOSITORY` to the website repository as `owner/repository`, and `GITHUB_BRANCH` to the branch that triggers the website deployment (commonly `main`).
2. Create a GitHub fine-grained personal access token limited to that repository. Grant **Contents: Read and write** and keep other permissions at their minimum. Store the token as the Worker secret `GITHUB_TOKEN`; never place it in this repository or frontend code.
3. Deploy the Worker and updated Admin page. The attach buttons accept JPG, PNG, or WebP files, up to 8 MB each and 20 MB total per batch (at most 10 files). Gallery files are committed together so they trigger one website deployment.
4. In Admin, choose the main image and select **Attach image**. For additional images, select one or more files and choose **Attach images**. Save the product after attaching. The images become available when the website deployment completes.

Set the token secret with Wrangler if preferred:

```powershell
npx wrangler secret put GITHUB_TOKEN
```

Uploaded image files remain in the website repository if a product is deleted or its image is changed; remove unused files from the repository manually when appropriate. This route adds no separate image-storage service, but GitHub and the website host's repository, deployment, and usage limits still apply.

The Worker validates manually entered image paths as root-relative website paths ending in `.jpg`, `.jpeg`, `.png`, or `.webp`. Existing D1 image keys that refer to unavailable R2 objects will not display; replace them with valid static website paths in Admin.

## Application behavior

- D1 stores product and category data, salon services and settings, and appointments. Admin authentication uses Google OAuth and signed Worker cookies, not D1.
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
