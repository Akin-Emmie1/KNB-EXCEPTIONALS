(function () {
  let userJwt = "";
  let userJwtExpiresAt = 0;

  function settings() {
    const config = window.KMB_CONFIG || {};
    if (!config.appwriteEndpoint || !config.appwriteProjectId || !config.appwriteFunctionUrl) {
      throw new Error("Appwrite is not fully configured. Set its Function domain in appwrite/config.js.");
    }
    return {
      endpoint: config.appwriteEndpoint.replace(/\/$/, ""),
      projectId: config.appwriteProjectId,
      functionUrl: config.appwriteFunctionUrl.replace(/\/$/, "")
    };
  }

  async function parseResponse(response) {
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("Appwrite returned an invalid response.");
      }
    }
    if (!response.ok) {
      const error = new Error(payload.message || payload.error || "The Appwrite request could not be completed.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function accountRequest(path, method = "GET", body) {
    const { endpoint, projectId } = settings();
    return parseResponse(await fetch(endpoint + path, {
      method,
      credentials: "include",
      headers: {
        "X-Appwrite-Project": projectId,
        ...(body === undefined ? {} : { "Content-Type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }));
  }

  async function ensureUserJwt() {
    if (userJwt && userJwtExpiresAt > Date.now() + 30_000) return userJwt;
    const account = await accountRequest("/account");
    if (typeof account.email !== "string" || account.email.toLowerCase() !== "iderakayode@gmail.com") {
      const error = new Error("Use the authorized administrator email to sign in.");
      error.status = 403;
      throw error;
    }
    const result = await accountRequest("/account/jwt", "POST", { duration: 900 });
    if (typeof result.jwt !== "string" || !result.jwt) throw new Error("Appwrite did not create an administrator session token.");
    userJwt = result.jwt;
    userJwtExpiresAt = Date.now() + 12 * 60 * 1000;
    return userJwt;
  }

  function functionPath(path) {
    if (!path.startsWith("/")) throw new Error("API paths must begin with a slash.");
    return path.startsWith("/api/") ? path : `/api${path}`;
  }

  async function apiRequest(path, options = {}) {
    const { functionUrl } = settings();
    const method = String(options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});
    if (path.startsWith("/admin/")) {
      const jwt = await ensureUserJwt();
      headers.set("X-Appwrite-User-JWT", jwt);
      headers.set("Authorization", `Bearer ${jwt}`);
    }
    else if (userJwt && userJwtExpiresAt > Date.now()) headers.set("X-Appwrite-User-JWT", userJwt);

    const response = await fetch(functionUrl + functionPath(path), {
      method,
      headers,
      body: options.body,
      credentials: "omit"
    });
    let payload = {};
    try {
      const text = await response.text();
      if (text) payload = JSON.parse(text);
    } catch {
      if (response.ok) throw new Error("The Appwrite API returned an invalid response.");
    }
    if (!response.ok) {
      const error = new Error(payload.error || payload.message || "The request could not be completed.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function signIn(email, password) {
    userJwt = "";
    userJwtExpiresAt = 0;
    try {
      await accountRequest("/account/sessions/current", "DELETE");
    } catch (error) {
      if (error.status !== 401) throw error;
    }
    await accountRequest("/account/sessions/email", "POST", { email, password });
    try {
      return await ensureUserJwt();
    } catch (error) {
      if (error.status === 403) await accountRequest("/account/sessions/current", "DELETE");
      throw error;
    }
  }

  async function signOut() {
    await accountRequest("/account/sessions/current", "DELETE");
    userJwt = "";
    userJwtExpiresAt = 0;
  }

  window.KNB_APPWRITE = { apiRequest, signIn, signOut };
})();
