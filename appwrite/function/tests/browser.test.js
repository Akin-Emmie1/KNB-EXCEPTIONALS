import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

test("browser client signs in through Appwrite and sends the user JWT to the Function domain", async () => {
  const source = await readFile(new URL("../../browser.js", import.meta.url), "utf8");
  const calls = [];
  const window = {
    KMB_CONFIG: {
      appwriteEndpoint: "https://appwrite.test/v1",
      appwriteProjectId: "test-project",
      appwriteFunctionUrl: "https://knb-api.test"
    }
  };
  const fetch = async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, options });
    if (url.endsWith("/account/sessions/current")) return Response.json({ message: "No active session" }, { status: 401 });
    if (url.endsWith("/account/sessions/email")) return Response.json({ $id: "session" }, { status: 201 });
    if (url.endsWith("/account/jwt")) return Response.json({ jwt: "short-lived-user-jwt" });
    if (url.endsWith("/account")) return Response.json({ $id: "admin-id", email: "iderakayode@gmail.com" });
    if (url.endsWith("/api/admin/auth/session")) return Response.json({ admin: { email: "iderakayode@gmail.com" } });
    return Response.json({ error: "Unexpected request" }, { status: 404 });
  };
  vm.runInNewContext(source, { window, fetch, Headers, Response, Date, Error, JSON });

  await window.KNB_APPWRITE.signIn("iderakayode@gmail.com", "not-a-real-password");
  const result = await window.KNB_APPWRITE.apiRequest("/admin/auth/session");
  const functionCall = calls.find(call => call.url.endsWith("/api/admin/auth/session"));

  assert.equal(result.admin.email, "iderakayode@gmail.com");
  assert.equal(functionCall.options.headers.get("X-Appwrite-User-JWT"), "short-lived-user-jwt");
  assert.equal(functionCall.options.headers.get("Authorization"), "Bearer short-lived-user-jwt");
  assert.equal(functionCall.options.credentials, "omit");
});

test("browser client replaces an existing Appwrite session before signing in", async () => {
  const source = await readFile(new URL("../../browser.js", import.meta.url), "utf8");
  const calls = [];
  const window = {
    KMB_CONFIG: {
      appwriteEndpoint: "https://appwrite.test/v1",
      appwriteProjectId: "test-project",
      appwriteFunctionUrl: "https://knb-api.test"
    }
  };
  const fetch = async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, options });
    if (url.endsWith("/account/sessions/current")) return new Response(null, { status: 204 });
    if (url.endsWith("/account/sessions/email")) return Response.json({ $id: "new-session" }, { status: 201 });
    if (url.endsWith("/account")) return Response.json({ $id: "admin-id", email: "iderakayode@gmail.com" });
    if (url.endsWith("/account/jwt")) return Response.json({ jwt: "short-lived-user-jwt" });
    return Response.json({ error: "Unexpected request" }, { status: 404 });
  };
  vm.runInNewContext(source, { window, fetch, Headers, Response, Date, Error, JSON });

  await window.KNB_APPWRITE.signIn("iderakayode@gmail.com", "not-a-real-password");

  assert.equal(calls[0].url, "https://appwrite.test/v1/account/sessions/current");
  assert.equal(calls[0].options.method, "DELETE");
  assert.equal(calls[1].url, "https://appwrite.test/v1/account/sessions/email");
  assert.equal(calls[1].options.method, "POST");
});

test("browser client routes public catalog requests to the configured Function domain", async () => {
  const source = await readFile(new URL("../../browser.js", import.meta.url), "utf8");
  const calls = [];
  const window = {
    KMB_CONFIG: {
      appwriteEndpoint: "https://appwrite.test/v1",
      appwriteProjectId: "test-project",
      appwriteFunctionUrl: "https://knb-api.test"
    }
  };
  const fetch = async (input, options = {}) => {
    calls.push({ url: String(input), options });
    return Response.json({ products: [] });
  };
  vm.runInNewContext(source, { window, fetch, Headers, Response, Date, Error, JSON });

  await window.KNB_APPWRITE.apiRequest("/products");

  assert.equal(calls[0].url, "https://knb-api.test/api/products");
  assert.equal(calls[0].options.method, "GET");
});
