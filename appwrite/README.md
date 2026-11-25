# KNB Appwrite migration

This migration targets the Appwrite project shown in the KNB setup session. The current Worker, D1 database, and storefront deployment remain unchanged until the Appwrite API and frontend have been tested.

## Create the initial Appwrite resources

1. In the KNB Appwrite project, open **API Keys** and create a temporary key named `KNB migration setup`.
2. Grant it the database read/write and bucket read/write scopes required to create databases, tables, columns, rows, and the image bucket. Do not send the key in chat or commit it to the repository.
3. Open a terminal in the project folder and run:

   ```powershell
   & "C:\Program Files\nodejs\node.exe" .\appwrite\setup.mjs
   ```

4. Save the API key by itself on one line in `appwrite.apikey` in the project root, or run the script without that file and paste the key into its hidden prompt. The file is ignored by Git; the script never prints or copies its contents.
5. After setup completes, revoke the temporary API key in Appwrite and delete `appwrite.apikey`. The API Function uses a restricted, Appwrite-generated ephemeral key; do not create or store a server API key in the website.

The script creates the `knb-data` serverless database, the KNB data tables, and an image bucket with file-level security. Each table stores its record as JSON text in a required `longtext` `payload` column, which is supported by Appwrite TablesDB. It seeds the default KNB categories and basic business settings. It is safe to rerun: existing database rows are not overwritten.

The script does not migrate existing D1 records or change the live website.

## Deploy the Appwrite API function

The API source is in `appwrite/function`. The root `appwrite.config.json` defines the `knb-api` function, its Node.js 22 runtime, CORS origin, and the limited `rows.read`, `rows.write`, and `files.write` scopes it needs.

1. Install the Appwrite CLI and sign in to the same Appwrite account:

   ```powershell
   npm install -g appwrite-cli
   appwrite login
   ```

2. From the project root, deploy the function:

   ```powershell
   appwrite push functions
   ```

3. In the Appwrite Console, confirm that function `knb-api` has an active deployment, **Execute access** set to `Any`, and the three scopes listed above. Add `knb-exceptional.vercel.app` as a Web platform in the Appwrite project settings so the browser can use email/password auth.
4. Copy the function's generated domain from the Console. Put it in `appwrite/config.js` as `appwriteFunctionUrl` and change `backend` from `"worker"` to `"appwrite"` only after the function is active and tested.

The storefront and admin pages remain on the existing Worker unless that explicit configuration switch is made. The function checks the Appwrite user JWT and allows admin operations only for `iderakayode@gmail.com`. Appointment time reservations use unique slot rows to prevent overlapping bookings. Uploaded images are stored in the Appwrite bucket with public read permission; database rows remain private.

Existing D1 records have not been imported. Keep the Worker and D1 database until the Appwrite API and both pages pass end-to-end testing and any required data import is complete.
