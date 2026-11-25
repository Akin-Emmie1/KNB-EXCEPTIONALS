import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../src/main.js";

const originalFetch = globalThis.fetch;
const originalEndpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT;
const originalProjectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;

beforeEach(() => {
  process.env.APPWRITE_FUNCTION_API_ENDPOINT = "https://appwrite.test/v1";
  process.env.APPWRITE_FUNCTION_PROJECT_ID = "test-project";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installAppwriteMock(initial = {}) {
  const tables = {
    categories: new Map(),
    products: new Map(),
    services: new Map(),
    appointments: new Map(),
    "booking-slots": new Map(),
    settings: new Map()
  };
  for (const [tableId, rows] of Object.entries(initial)) {
    for (const [id, value] of Object.entries(rows)) {
      tables[tableId].set(id, JSON.stringify(value));
    }
  }

  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.pathname === "/v1/account") {
      if (options.headers?.["X-Appwrite-JWT"] === "valid-admin-jwt") {
        return Response.json({ $id: "admin-id", email: "iderakayode@gmail.com" });
      }
      return Response.json({ code: 401, message: "Invalid JWT" }, { status: 401 });
    }

    const match = url.pathname.match(/^\/v1\/tablesdb\/knb-data\/tables\/([^/]+)\/rows(?:\/([^/]+))?$/);
    if (!match) return Response.json({ code: 404, message: "Not found" }, { status: 404 });
    const tableId = decodeURIComponent(match[1]);
    const rowId = match[2] ? decodeURIComponent(match[2]) : "";
    const table = tables[tableId];
    if (!table) return Response.json({ code: 404, message: "Table not found" }, { status: 404 });

    if (options.method === "GET" && !rowId) {
      return Response.json({
        total: table.size,
        rows: [...table].map(([id, payload]) => ({ $id: id, payload }))
      });
    }
    if (options.method === "GET" && rowId) {
      if (!table.has(rowId)) return Response.json({ code: 404, message: "Row not found" }, { status: 404 });
      return Response.json({ $id: rowId, payload: table.get(rowId) });
    }
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      if (table.has(body.rowId)) return Response.json({ code: 409, message: "Row exists" }, { status: 409 });
      table.set(body.rowId, body.data.payload);
      return Response.json({ $id: body.rowId, payload: body.data.payload }, { status: 201 });
    }
    if (options.method === "PUT" && rowId) {
      if (!table.has(rowId)) return Response.json({ code: 404, message: "Row not found" }, { status: 404 });
      const body = JSON.parse(options.body);
      table.set(rowId, body.data.payload);
      return Response.json({ $id: rowId, payload: body.data.payload });
    }
    if (options.method === "DELETE" && rowId) {
      if (!table.delete(rowId)) return Response.json({ code: 404, message: "Row not found" }, { status: 404 });
      return new Response(null, { status: 204 });
    }
    return Response.json({ code: 405, message: "Method not allowed" }, { status: 405 });
  };
  return tables;
}

async function invoke({ path, method = "GET", headers = {}, body, bodyBinary }) {
  let response;
  await handler({
    req: {
      url: `https://knb-api.test${path}`,
      path,
      method,
      headers: { "x-appwrite-key": "test-key", ...headers },
      bodyJson: body,
      bodyBinary
    },
    res: {
      json(value, status = 200) {
        response = { status, body: value };
        return response;
      },
      text(value, status = 200, headers = {}) {
        response = { status, body: value, headers };
        return response;
      }
    },
    error() {}
  });
  return response;
}

test("public product list joins category metadata and keeps image paths absolute", async () => {
  installAppwriteMock({
    categories: {
      clothes: { name: "Clothes", category_type: "collectibles" }
    },
    products: {
      jacket: {
        name: "Denim jacket",
        slug: "denim-jacket",
        categoryId: "clothes",
        price: 25000,
        inStock: true,
        mainImageKey: "/images/jacket.jpg",
        galleryImageKeys: []
      }
    }
  });

  const result = await invoke({ path: "/api/products?type=collectibles" });

  assert.equal(result.status, 200);
  assert.equal(result.body.products.length, 1);
  assert.equal(result.body.products[0].categoryType, "collectibles");
  assert.equal(result.body.products[0].image, "https://knb-exceptional.vercel.app/images/jacket.jpg");
  assert.deepEqual(result.body.products[0].images, ["https://knb-exceptional.vercel.app/images/jacket.jpg"]);
});

test("admin endpoints reject requests without an Appwrite session JWT", async () => {
  installAppwriteMock();

  const result = await invoke({ path: "/api/admin/products" });

  assert.equal(result.status, 401);
  assert.equal(result.body.error, "Please sign in as an administrator.");
});

test("CORS allows the configured storefront and rejects other origins", async () => {
  installAppwriteMock();

  const allowed = await invoke({
    path: "/api/health",
    method: "OPTIONS",
    headers: {
      origin: "https://knb-exceptional.vercel.app",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-appwrite-user-jwt,authorization"
    }
  });
  const rejected = await invoke({
    path: "/api/health",
    method: "OPTIONS",
    headers: { origin: "https://attacker.example" }
  });

  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers["Access-Control-Allow-Origin"], "https://knb-exceptional.vercel.app");
  assert.match(allowed.headers["Access-Control-Allow-Headers"], /Authorization/i);
  assert.equal(rejected.status, 403);
});

test("admin endpoints accept the JWT in a standard authorization header", async () => {
  installAppwriteMock();

  const result = await invoke({
    path: "/api/admin/auth/session",
    headers: { authorization: "Bearer valid-admin-jwt" }
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.admin.email, "iderakayode@gmail.com");
});

test("only the configured administrator can access admin endpoints", async () => {
  installAppwriteMock();
  globalThis.fetch = async (input, options = {}) => {
    if (new URL(input).pathname === "/v1/account") {
      return Response.json({ $id: "other-user", email: "other@example.com" });
    }
    return originalFetch(input, options);
  };

  const result = await invoke({
    path: "/api/admin/auth/session",
    headers: { "x-appwrite-user-jwt": "valid-admin-jwt" }
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.error, "Use the authorized administrator email to sign in.");
});

test("overlapping appointment requests cannot both reserve the same time", async () => {
  const tables = installAppwriteMock({
    services: {
      haircut: { name: "Haircut", price: 5000, durationMinutes: 30, isActive: true }
    },
    settings: {
      salon: {
        timezone: "Africa/Lagos",
        slotIntervalMinutes: 30,
        openingHours: Object.fromEntries(
          Array.from({ length: 7 }, (_, day) => [String(day), { closed: false, open: "09:00", close: "17:00" }])
        )
      }
    }
  });
  const appointment = {
    serviceId: "haircut",
    date: "2099-01-05",
    time: "10:00",
    customerName: "Test customer",
    customerPhone: "+2348012345678",
    customerEmail: ""
  };
  const request = () => invoke({ path: "/api/appointments", method: "POST", body: appointment });

  const results = await Promise.all([request(), request()]);

  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal(tables.appointments.size, 1);
  assert.ok(tables["booking-slots"].size > 0);
});

test("admin cannot reschedule an appointment to an inactive service", async () => {
  installAppwriteMock({
    services: {
      "inactive-service": { name: "Inactive service", price: 5000, durationMinutes: 30, isActive: false }
    },
    appointments: {
      "appointment-1": {
        serviceId: "current-service",
        serviceName: "Current service",
        price: 5000,
        durationMinutes: 30,
        startsAt: "2099-01-05T10:00:00.000Z",
        endsAt: "2099-01-05T10:30:00.000Z",
        status: "confirmed"
      }
    }
  });

  const result = await invoke({
    path: "/api/admin/appointments/appointment-1",
    method: "PUT",
    headers: { "x-appwrite-user-jwt": "valid-admin-jwt" },
    body: { serviceId: "inactive-service", date: "2099-01-05", time: "10:00" }
  });

  assert.equal(result.status, 400);
  assert.match(result.body.error, /inactive service/i);
});

test("admin image uploads require a valid image and grant public read access", async () => {
  installAppwriteMock();
  const defaultFetch = globalThis.fetch;
  let uploadedPermissions;
  globalThis.fetch = async (input, options = {}) => {
    if (new URL(input).pathname === "/v1/account") {
      return Response.json({ $id: "admin-id", email: "iderakayode@gmail.com" });
    }
    if (new URL(input).pathname === "/v1/storage/buckets/knb-product-images/files") {
      uploadedPermissions = options.body.getAll("permissions[]");
      return Response.json({ $id: options.body.get("fileId") }, { status: 201 });
    }
    return defaultFetch(input, options);
  };
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), "photo.jpg");
  const request = new Request("https://knb-api.test/api/admin/images", { method: "POST", body: form });
  const bodyBinary = new Uint8Array(await request.arrayBuffer());

  const result = await invoke({
    path: "/api/admin/images",
    method: "POST",
    headers: {
      "x-appwrite-user-jwt": "valid-admin-jwt",
      "content-type": request.headers.get("content-type")
    },
    bodyBinary
  });

  assert.equal(result.status, 201);
  assert.match(result.body.images[0].path, /^appwrite:/);
  assert.deepEqual(uploadedPermissions, ['read("any")']);
});

afterEach(() => {
  if (originalEndpoint === undefined) delete process.env.APPWRITE_FUNCTION_API_ENDPOINT;
  else process.env.APPWRITE_FUNCTION_API_ENDPOINT = originalEndpoint;
  if (originalProjectId === undefined) delete process.env.APPWRITE_FUNCTION_PROJECT_ID;
  else process.env.APPWRITE_FUNCTION_PROJECT_ID = originalProjectId;
});
