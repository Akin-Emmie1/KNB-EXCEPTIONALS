import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const endpoint = "https://fra.cloud.appwrite.io/v1";
const projectId = "6b044bc8002081f05a75";
const databaseId = "knb-data";
const bucketId = "knb-product-images";
const apiKeyFile = new URL("../appwrite.apikey", import.meta.url);

class AppwriteError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readApiKey() {
  try {
    const key = (await readFile(apiKeyFile, "utf8")).replace(/^\uFEFF/, "").trim();
    if (!key || /[\r\n]/.test(key)) {
      throw new Error("appwrite.apikey must contain only the API key on one line.");
    }
    return key;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("Create appwrite.apikey with the API key on one line, or run this script in an interactive terminal.");
  }

  process.stdout.write("Paste the Appwrite API key (input hidden): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = chunk => {
      for (const byte of chunk) {
        if (byte === 3) {
          cleanup();
          reject(new Error("Setup cancelled."));
          return;
        }
        if (byte === 13 || byte === 10) {
          cleanup();
          if (!value) reject(new Error("An API key is required."));
          else resolve(value);
          return;
        }
        if (byte === 8 || byte === 127) value = value.slice(0, -1);
        else if (byte >= 32 && byte <= 126) value += String.fromCharCode(byte);
      }
    };
    process.stdin.on("data", onData);
  });
}

function createApi(key) {
  return async function api(path, method = "GET", body) {
    const response = await fetch(endpoint + path, {
      method,
      headers: {
        "X-Appwrite-Project": projectId,
        "X-Appwrite-Key": key,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    const text = await response.text();
    let result = {};
    if (text) {
      try {
        result = JSON.parse(text);
      } catch {
        if (response.ok) throw new AppwriteError(response.status, "Appwrite returned an invalid response.");
        throw new AppwriteError(response.status, `Appwrite request failed with HTTP ${response.status}.`);
      }
    }

    if (!response.ok) {
      throw new AppwriteError(response.status, result.message || "The Appwrite request failed.");
    }
    return result;
  };
}

async function ensureResource(api, resourcePath, createPath, body) {
  try {
    return await api(resourcePath);
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  try {
    return await api(createPath, "POST", body);
  } catch (error) {
    if (error.status !== 409) throw error;
    return api(resourcePath);
  }
}

async function waitUntilAvailable(api, path, resourceName) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const resource = await api(path);
    if (!resource.status || resource.status === "available") return;
    if (resource.status === "failed") {
      throw new Error(`Appwrite could not make ${resourceName} available.`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out while waiting for ${resourceName} to become available.`);
}

async function seedRow(api, tableId, rowId, payload) {
  const rowPath = `/tablesdb/${databaseId}/tables/${tableId}/rows/${rowId}`;
  try {
    await api(rowPath);
    return;
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  try {
    await api(`/tablesdb/${databaseId}/tables/${tableId}/rows`, "POST", {
      rowId,
      data: { payload: JSON.stringify(payload) },
      permissions: []
    });
  } catch (error) {
    if (error.status !== 409) throw error;
  }
}

async function main() {
  const key = await readApiKey();
  const api = createApi(key);

  await ensureResource(api, `/tablesdb/${databaseId}`, "/tablesdb", {
    databaseId,
    name: "KNB Exceptionals",
    enabled: true,
    specification: "serverless"
  });
  process.stdout.write("Database ready.\n");

  const tables = [
    ["categories", "Categories"],
    ["products", "Products"],
    ["services", "Salon services"],
    ["appointments", "Appointments"],
    ["booking-slots", "Appointment booking slots"],
    ["settings", "Business settings"]
  ];

  for (const [tableId, name] of tables) {
    const tablePath = `/tablesdb/${databaseId}/tables`;
    await ensureResource(api, `${tablePath}/${tableId}`, tablePath, {
      tableId,
      name,
      enabled: true,
      rowSecurity: false,
      columns: [{ key: "payload", type: "longtext", required: true }]
    });
    await waitUntilAvailable(api, `${tablePath}/${tableId}`, `the ${name} table`);
    await ensureResource(api, `${tablePath}/${tableId}/columns/payload`, `${tablePath}/${tableId}/columns/longtext`, {
      key: "payload",
      required: true
    });
    await waitUntilAvailable(api, `${tablePath}/${tableId}/columns/payload`, `the ${name} payload column`);
    process.stdout.write(`Table ready: ${tableId}\n`);
  }

  await ensureResource(api, `/storage/buckets/${bucketId}`, "/storage/buckets", {
    bucketId,
    name: "KNB product images",
    permissions: [],
    fileSecurity: true,
    enabled: true,
    maximumFileSize: 8 * 1024 * 1024,
    allowedFileExtensions: ["jpg", "jpeg", "png", "webp"],
    compression: "none",
    encryption: false,
    antivirus: false,
    transformations: false,
    stripMetadata: true
  });
  process.stdout.write("Image bucket ready.\n");

  const categories = [
    ["collectibles-clothes", "Clothes", "collectibles"],
    ["collectibles-shoes", "Shoes", "collectibles"],
    ["collectibles-bags", "Bags", "collectibles"],
    ["collectibles-accessories", "Accessories", "collectibles"],
    ["beauty-weave-ons", "Weave-ons", "beauty"],
    ["beauty-hair-extensions", "Hair extensions", "beauty"],
    ["beauty-attachments", "Attachments", "beauty"],
    ["beauty-wigs", "Wigs", "beauty"],
    ["beauty-hair-accessories", "Hair accessories", "beauty"],
    ["beauty-other", "Other hair & beauty merchandise", "beauty"]
  ];
  for (const [id, name, categoryType] of categories) {
    await seedRow(api, "categories", id, {
      id,
      name,
      slug: id.replace(/^(collectibles|beauty)-/, ""),
      category_type: categoryType,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }

  const now = new Date().toISOString();
  await seedRow(api, "settings", "salon", {
    timezone: "Africa/Lagos",
    openingHours: {},
    slotIntervalMinutes: 30,
    updatedAt: now
  });
  await seedRow(api, "settings", "business", {
    businessName: "KNB EXCEPTIONALS",
    phone: "+2348034269134",
    email: "iderakayode@gmail.com",
    whatsapp: "+2348034269134",
    address: "C5 & C6, Run Shopping Complex, opposite Queen Esther, behind Tantalizers, Redemption City of God, Mowe, Ogun State.",
    updatedAt: now
  });

  process.stdout.write("KNB Appwrite resources are ready. No existing data or Cloudflare resources were changed.\n");
}

main().catch(error => {
  process.stderr.write(`Setup failed: ${error.message}\n`);
  process.exitCode = 1;
});
