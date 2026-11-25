const DATABASE_ID = "knb-data";
const ADMIN_EMAIL = "iderakayode@gmail.com";
const TABLES = {
  categories: "categories",
  products: "products",
  services: "services",
  appointments: "appointments",
  slots: "booking-slots",
  settings: "settings"
};
const BUCKET_ID = "knb-product-images";
const MAX_IMAGE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BATCH_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BATCH_FILES = 10;
const DEFAULT_BUSINESS = {
  businessName: "KNB EXCEPTIONALS",
  phone: "+2348034269134",
  email: ADMIN_EMAIL,
  whatsapp: "+2348034269134",
  address: "C5 & C6, Run Shopping Complex, opposite Queen Esther, behind Tantalizers, Redemption City of God, Mowe, Ogun State.",
  tiktokDisplayName: "Idera Kayode (KNB Exceptional)"
};
const ACTIVE_APPOINTMENT_STATUSES = new Set(["pending", "confirmed"]);
const HTTP_STATUS = Symbol("httpStatus");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function withStatus(body, status) {
  return { [HTTP_STATUS]: status, body };
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  const allowedOrigins = (process.env.KNB_ALLOWED_ORIGINS || "https://knb-exceptional.vercel.app")
    .split(",").map(value => value.trim()).filter(Boolean);
  if (!allowedOrigins.includes(origin)) throw new HttpError(403, "This website origin is not allowed.");
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Appwrite-User-JWT, Authorization",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}

function config() {
  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT;
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;
  if (!endpoint || !projectId) throw new HttpError(503, "The Appwrite Function is not configured.");
  return { endpoint: endpoint.replace(/\/$/, ""), projectId };
}

async function appwrite(req, path, method = "GET", body) {
  const { endpoint, projectId } = config();
  const key = req.headers["x-appwrite-key"];
  if (!key) throw new HttpError(503, "Appwrite did not provide the Function API key.");
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await fetch(endpoint + path, {
    method,
    headers: {
      "X-Appwrite-Project": projectId,
      "X-Appwrite-Key": key,
      ...(body === undefined || isFormData ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: isFormData ? body : JSON.stringify(body) })
  });
  const text = await response.text();
  let result = {};
  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
      throw new HttpError(502, "Appwrite returned an invalid response.");
    }
  }
  if (!response.ok) {
    const status = Number(result.code) || response.status;
    throw new HttpError(status, typeof result.message === "string" ? result.message : "The Appwrite request failed.");
  }
  return result;
}

function tablePath(tableId) {
  return `/tablesdb/${DATABASE_ID}/tables/${tableId}`;
}

function validId(value, field = "Record ID") {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new HttpError(400, `${field} is invalid.`);
  }
  return value;
}

function requiredText(value, field, max = 200) {
  if (typeof value !== "string") throw new HttpError(400, `${field} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new HttpError(400, `${field} must be between 1 and ${max} characters.`);
  }
  return normalized;
}

function optionalText(value, field, max = 10000) {
  if (value == null) return "";
  if (typeof value !== "string" || value.trim().length > max) throw new HttpError(400, `${field} is invalid.`);
  return value.trim();
}

function price(value, field, nullable = false) {
  if (nullable && (value === null || value === "" || value === undefined)) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000000000) {
    throw new HttpError(400, `${field} must be a non-negative price.`);
  }
  return Math.round(number * 100) / 100;
}

function parseArray(value, field, maxItems = 40, maxLength = 100) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new HttpError(400, `${field} must be a list.`);
  return value.map(item => requiredText(item, field, maxLength));
}

function slugify(value) {
  return value.normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

function validEmail(value, required = false) {
  if (value == null || value === "") {
    if (required) throw new HttpError(400, "A valid email address is required.");
    return "";
  }
  const email = requiredText(value, "Email", 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "A valid email address is required.");
  return email.toLowerCase();
}

function validPhone(value) {
  if (value == null || value === "") return "";
  const phone = requiredText(value, "Phone", 32);
  if (!/^\+?[0-9 ()-]{6,31}$/.test(phone)) throw new HttpError(400, "Enter a valid phone number.");
  return phone;
}

function imageKey(value) {
  if (value == null || value === "") return null;
  const key = requiredText(value, "Image path", 2048);
  if (/^appwrite:[A-Za-z0-9_-]{1,36}$/.test(key)) return key;
  if (!key.startsWith("/") || key.startsWith("//") || key.includes("\\") ||
      /[?#\u0000-\u001f]/.test(key) || !/\.(jpe?g|png|webp)$/i.test(key)) {
    throw new HttpError(400, "Use an uploaded image or a safe website image path ending in .jpg, .jpeg, or .png.");
  }
  const segments = key.slice(1).split("/");
  let decoded;
  try {
    decoded = segments.map(segment => decodeURIComponent(segment));
  } catch {
    throw new HttpError(400, "Image path is invalid.");
  }
  if (segments.some(segment => !segment) ||
      decoded.some(segment => segment === "." || segment === ".." || segment.includes("%") ||
        /[\/\\\u0000-\u001f]/.test(segment))) {
    throw new HttpError(400, "Image path is invalid.");
  }
  return key;
}

function imageUrl(key) {
  if (!key) return "";
  if (!key.startsWith("appwrite:")) return `https://knb-exceptional.vercel.app${key}`;
  const { endpoint, projectId } = config();
  const fileId = encodeURIComponent(key.slice("appwrite:".length));
  return `${endpoint}/storage/buckets/${BUCKET_ID}/files/${fileId}/view?project=${encodeURIComponent(projectId)}`;
}

function detectedImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
      bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 &&
      bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 &&
      bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return null;
}

async function uploadStorageFile(req, bytes, type) {
  const fileId = crypto.randomUUID();
  const { endpoint, projectId } = config();
  const chunkSize = 5 * 1024 * 1024;
  const chunked = bytes.length > chunkSize;
  let uploadedFile;
  let uploadStarted = false;
  try {
    for (let start = 0; start < bytes.length; start += chunkSize) {
      const end = Math.min(start + chunkSize, bytes.length);
      const form = new FormData();
      if (start === 0) {
        form.append("fileId", fileId);
        form.append("permissions[]", 'read("any")');
      }
      form.append("file", new Blob([bytes.slice(start, end)], { type: type.mimeType }), `knb-image.${type.extension}`);
      uploadStarted = true;
      const response = await fetch(`${endpoint}/storage/buckets/${BUCKET_ID}/files`, {
        method: "POST",
        headers: {
          "X-Appwrite-Project": projectId,
          "X-Appwrite-Key": req.headers["x-appwrite-key"],
          ...(chunked ? { "Content-Range": `bytes ${start}-${end - 1}/${bytes.length}` } : {}),
          ...(start > 0 ? { "X-Appwrite-ID": fileId } : {})
        },
        body: form
      });
      const text = await response.text();
      let result = {};
      if (text) {
        try {
          result = JSON.parse(text);
        } catch {
          throw new HttpError(502, "Appwrite returned an invalid image upload response.");
        }
      }
      if (!response.ok) {
        throw new HttpError(Number(result.code) || response.status,
          typeof result.message === "string" ? result.message : "Appwrite could not store the image.");
      }
      uploadedFile = result;
    }
  } catch (error) {
    if (uploadStarted) {
      try {
        await appwrite(req, `/storage/buckets/${BUCKET_ID}/files/${encodeURIComponent(fileId)}`, "DELETE");
      } catch (cleanupError) {
        if (cleanupError.status !== 404) {
          throw new HttpError(502, "Image upload failed and Appwrite could not clean up the partial file.");
        }
      }
    }
    throw error;
  }
  if (uploadedFile?.$id !== fileId) throw new HttpError(502, "Appwrite returned an invalid image upload result.");
  return uploadedFile;
}

async function uploadProductImages(req) {
  const contentType = req.headers["content-type"] || "";
  const byteLength = req.bodyBinary?.byteLength ?? req.bodyBinary?.length ?? 0;
  if (!contentType.toLowerCase().startsWith("multipart/form-data;") || !req.bodyBinary) {
    throw new HttpError(400, "Choose valid image files to upload.");
  }
  if (byteLength > MAX_IMAGE_BATCH_BYTES + 1024 * 1024) {
    throw new HttpError(413, "The image upload batch is too large.");
  }
  let form;
  try {
    form = await new Response(req.bodyBinary, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new HttpError(400, "The image upload form is invalid.");
  }
  const files = form.getAll("files");
  if (files.length < 1 || files.length > MAX_IMAGE_BATCH_FILES ||
      files.some(file => typeof file === "string" || typeof file.arrayBuffer !== "function")) {
    throw new HttpError(400, `Choose between 1 and ${MAX_IMAGE_BATCH_FILES} image files.`);
  }
  const sizes = files.map(file => file.size);
  if (sizes.some(size => size < 1 || size > MAX_IMAGE_FILE_BYTES) ||
      sizes.reduce((total, size) => total + size, 0) > MAX_IMAGE_BATCH_BYTES) {
    throw new HttpError(413, "Images must be at most 8 MB each and 20 MB per upload.");
  }
  const uploaded = [];
  try {
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = detectedImageType(bytes);
      if (!type) throw new HttpError(400, "Use a valid JPEG, PNG, or WebP image.");
      const stored = await uploadStorageFile(req, bytes, type);
      uploaded.push(stored.$id);
    }
  } catch (error) {
    await Promise.all(uploaded.map(fileId =>
      appwrite(req, `/storage/buckets/${BUCKET_ID}/files/${encodeURIComponent(fileId)}`, "DELETE")
    ));
    throw error;
  }
  return { images: uploaded.map(fileId => ({ path: `appwrite:${fileId}` })) };
}

async function listRows(req, tableId) {
  const result = await appwrite(req, `${tablePath(tableId)}/rows?limit=500`);
  if (!Array.isArray(result.rows)) throw new HttpError(502, `Appwrite returned an invalid ${tableId} response.`);
  return result.rows.map(row => ({ id: row.$id, ...decodePayload(row.payload, tableId) }));
}

function decodePayload(value, tableId) {
  if (typeof value !== "string") throw new HttpError(500, `A ${tableId} record has invalid stored data.`);
  try {
    const payload = JSON.parse(value);
    if (!payload || Array.isArray(payload) || typeof payload !== "object") throw new Error("Object expected.");
    return payload;
  } catch {
    throw new HttpError(500, `A ${tableId} record contains invalid stored data.`);
  }
}

async function getRow(req, tableId, id) {
  try {
    const row = await appwrite(req, `${tablePath(tableId)}/rows/${encodeURIComponent(id)}`);
    return { id: row.$id, ...decodePayload(row.payload, tableId) };
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function createRow(req, tableId, id, value) {
  const row = await appwrite(req, `${tablePath(tableId)}/rows`, "POST", {
    rowId: id,
    data: { payload: JSON.stringify(value) },
    permissions: []
  });
  return { id: row.$id, ...value };
}

async function updateRow(req, tableId, id, value) {
  const row = await appwrite(req, `${tablePath(tableId)}/rows/${encodeURIComponent(id)}`, "PUT", {
    data: { payload: JSON.stringify(value) },
    permissions: []
  });
  return { id: row.$id, ...value };
}

async function deleteRow(req, tableId, id) {
  await appwrite(req, `${tablePath(tableId)}/rows/${encodeURIComponent(id)}`, "DELETE");
}

async function requireAdmin(req) {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const jwt = req.headers["x-appwrite-user-jwt"] || bearer;
  if (!jwt) throw new HttpError(401, "Please sign in as an administrator.");
  const { endpoint, projectId } = config();
  const response = await fetch(`${endpoint}/account`, {
    headers: { "X-Appwrite-Project": projectId, "X-Appwrite-JWT": jwt }
  });
  const text = await response.text();
  let user = {};
  if (text) {
    try {
      user = JSON.parse(text);
    } catch {
      throw new HttpError(502, "Appwrite returned an invalid account response.");
    }
  }
  if (!response.ok) throw new HttpError(401, "Your administrator session has expired.");
  if (typeof user.email !== "string" || user.email.toLowerCase() !== ADMIN_EMAIL) {
    throw new HttpError(403, "Use the authorized administrator email to sign in.");
  }
  return { id: user.$id, email: ADMIN_EMAIL };
}

async function categoryMap(req) {
  return new Map((await listRows(req, TABLES.categories)).map(category => [category.id, category]));
}

function productResponse(product, categories) {
  const category = categories.get(product.categoryId);
  const keys = [product.mainImageKey, ...(product.galleryImageKeys || [])].filter(Boolean);
  const uniqueKeys = [...new Set(keys)];
  const primaryKey = uniqueKeys[0] || "";
  return {
    ...product,
    category: category?.name || product.category || "",
    categoryType: category?.category_type || product.categoryType || "",
    category_type: category?.category_type || product.category_type || "",
    price: Number(product.price || 0),
    oldPrice: product.oldPrice == null ? null : Number(product.oldPrice),
    image: imageUrl(primaryKey),
    imageKey: primaryKey,
    images: uniqueKeys.map(imageUrl),
    imageKeys: uniqueKeys,
    inStock: product.inStock !== false,
    dateAdded: product.dateAdded || product.createdAt || "",
    rating: Number(product.rating || 0),
    reviewCount: Number(product.reviewCount || 0),
    sizes: Array.isArray(product.sizes) ? product.sizes : [],
    colors: Array.isArray(product.colors) ? product.colors : []
  };
}

async function products(req, url, id = "") {
  const categoryList = await categoryMap(req);
  let items = (await listRows(req, TABLES.products)).map(product => productResponse(product, categoryList));
  if (id) {
    const product = items.find(item => item.id === id || item.slug === id);
    if (!product) throw new HttpError(404, "Product not found.");
    return { product };
  }
  const type = url.searchParams.get("type");
  if (type && type !== "collectibles" && type !== "beauty") throw new HttpError(400, "Unknown product collection.");
  const categoryId = url.searchParams.get("categoryId");
  const query = (url.searchParams.get("q") || "").trim().toLowerCase();
  if (type) items = items.filter(item => item.categoryType === type);
  if (categoryId) items = items.filter(item => item.categoryId === categoryId);
  if (query) items = items.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(query));
  items.sort((a, b) => String(b.dateAdded).localeCompare(String(a.dateAdded)));
  return { products: items };
}

async function categories(req, type = "") {
  let items = await listRows(req, TABLES.categories);
  if (type && type !== "collectibles" && type !== "beauty") throw new HttpError(400, "Unknown category type.");
  if (type) items = items.filter(item => item.category_type === type);
  items.sort((a, b) => String(a.category_type).localeCompare(String(b.category_type)) || a.name.localeCompare(b.name));
  return { categories: items };
}

async function services(req, activeOnly = true) {
  let items = await listRows(req, TABLES.services);
  if (activeOnly) items = items.filter(item => item.isActive !== false);
  items.sort((a, b) => a.name.localeCompare(b.name));
  return {
    services: items.map(item => ({
      ...item,
      price: Number(item.price || 0),
      durationMinutes: Number(item.durationMinutes || 0),
      image: imageUrl(item.imageKey)
    }))
  };
}

async function setting(req, id, fallback) {
  return (await getRow(req, TABLES.settings, id)) || fallback;
}

async function publicSettings(req) {
  const [business, salon] = await Promise.all([
    setting(req, "business", DEFAULT_BUSINESS),
    setting(req, "salon", { timezone: "Africa/Lagos", openingHours: {}, slotIntervalMinutes: 30 })
  ]);
  return { settings: { ...DEFAULT_BUSINESS, ...business, timezone: salon.timezone, openingHours: salon.openingHours } };
}

function normalizeProduct(body, category) {
  const name = requiredText(body.name, "Product name", 180);
  if (!category) throw new HttpError(400, "Choose an existing product category.");
  const tag = body.tag == null || body.tag === "" ? null : body.tag;
  if (tag !== null && tag !== "new" && tag !== "sale") throw new HttpError(400, "Choose a valid product tag.");
  if (body.inStock != null && typeof body.inStock !== "boolean") throw new HttpError(400, "Availability must be true or false.");
  const mainImageKey = imageKey(body.mainImageKey);
  const galleryImageKeys = parseArray(body.galleryImageKeys, "Gallery image paths", 40, 2048).map(imageKey);
  if (new Set(galleryImageKeys).size !== galleryImageKeys.length ||
      (mainImageKey && galleryImageKeys.includes(mainImageKey))) {
    throw new HttpError(400, "Product images must be unique.");
  }
  const now = new Date().toISOString();
  return {
    name,
    slug: `${slugify(name) || "product"}-${crypto.randomUUID().slice(0, 8)}`,
    categoryId: category.id,
    price: price(body.price, "Price"),
    oldPrice: price(body.oldPrice, "Old price", true),
    tag,
    description: optionalText(body.description, "Description", 2000),
    longDescription: optionalText(body.longDescription, "Full description", 10000),
    material: optionalText(body.material, "Material", 120),
    condition: optionalText(body.condition, "Condition", 120),
    origin: optionalText(body.origin, "Origin", 120),
    inStock: body.inStock !== false,
    sizes: parseArray(body.sizes, "Sizes"),
    colors: parseArray(body.colors, "Colors", 40, 30),
    mainImageKey,
    galleryImageKeys,
    dateAdded: now,
    updatedAt: now
  };
}

async function saveProduct(req, body, id = "") {
  const categoryId = validId(requiredText(body.categoryId, "Product category", 80), "Product category");
  const category = await getRow(req, TABLES.categories, categoryId);
  const value = normalizeProduct(body, category);
  if (id) {
    const previous = await getRow(req, TABLES.products, id);
    if (!previous) throw new HttpError(404, "Product not found.");
    value.slug = `${slugify(value.name) || "product"}-${id.slice(0, 8)}`;
    value.dateAdded = previous.dateAdded || previous.createdAt || value.dateAdded;
    return { product: productResponse({ id, ...await updateRow(req, TABLES.products, id, value) }, await categoryMap(req)) };
  }
  const newId = crypto.randomUUID();
  return { product: productResponse({ id: newId, ...await createRow(req, TABLES.products, newId, value) }, await categoryMap(req)) };
}

async function saveCategory(req, body, id = "") {
  const name = requiredText(body.name, "Category name", 100);
  const slug = slugify(name);
  if (!slug) throw new HttpError(400, "Category name must contain letters or numbers.");
  const type = body.type;
  if (type !== "collectibles" && type !== "beauty") throw new HttpError(400, "Choose a valid category type.");
  const existing = await listRows(req, TABLES.categories);
  if (existing.some(item => item.id !== id && item.category_type === type && item.slug === slug)) {
    throw new HttpError(409, "A category with that name already exists in this business area.");
  }
  const now = new Date().toISOString();
  const value = { name, slug, category_type: type, updated_at: now };
  if (id) {
    if (!await getRow(req, TABLES.categories, id)) throw new HttpError(404, "Category not found.");
    await updateRow(req, TABLES.categories, id, value);
    return { ok: true };
  }
  const newId = crypto.randomUUID();
  return { category: { id: newId, ...await createRow(req, TABLES.categories, newId, value) } };
}

function normalizeService(body) {
  const durationMinutes = Number(body.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 720) {
    throw new HttpError(400, "Duration must be between 1 and 720 minutes.");
  }
  if (body.isActive != null && typeof body.isActive !== "boolean") {
    throw new HttpError(400, "Service availability must be true or false.");
  }
  return {
    name: requiredText(body.name, "Service name", 180),
    description: optionalText(body.description, "Description", 2000),
    price: price(body.price, "Price"),
    durationMinutes,
    imageKey: imageKey(body.imageKey),
    isActive: body.isActive !== false,
    updatedAt: new Date().toISOString()
  };
}

async function saveService(req, body, id = "") {
  const value = normalizeService(body);
  if (id) {
    if (!await getRow(req, TABLES.services, id)) throw new HttpError(404, "Salon service not found.");
    return { service: await updateRow(req, TABLES.services, id, value) };
  }
  const newId = crypto.randomUUID();
  return { service: await createRow(req, TABLES.services, newId, { ...value, createdAt: value.updatedAt }) };
}

function validateHours(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Opening hours must include all seven days.");
  }
  const result = {};
  for (let day = 0; day <= 6; day++) {
    const entry = value[String(day)];
    if (!entry || typeof entry !== "object") throw new HttpError(400, "Opening hours must include all seven days.");
    if (entry.closed === true) {
      result[String(day)] = { closed: true };
      continue;
    }
    const open = requiredText(entry.open, "Opening time", 5);
    const close = requiredText(entry.close, "Closing time", 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(close) ||
        close <= open) throw new HttpError(400, "Opening and closing times must be valid and closing must be later.");
    result[String(day)] = { open, close, closed: false };
  }
  return result;
}

async function updateSalonSettings(req, body) {
  const openingHours = validateHours(body.openingHours);
  const timezone = requiredText(body.timezone || "Africa/Lagos", "Timezone", 64);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new HttpError(400, "Choose a valid timezone.");
  }
  const slotIntervalMinutes = Number(body.slotIntervalMinutes);
  if (!Number.isInteger(slotIntervalMinutes) || slotIntervalMinutes < 5 || slotIntervalMinutes > 180) {
    throw new HttpError(400, "Slot interval must be between 5 and 180 minutes.");
  }
  const value = { timezone, openingHours, slotIntervalMinutes, updatedAt: new Date().toISOString() };
  const existing = await getRow(req, TABLES.settings, "salon");
  await (existing
    ? updateRow(req, TABLES.settings, "salon", value)
    : createRow(req, TABLES.settings, "salon", value));
  return { settings: value };
}

async function updateBusinessSettings(req, body) {
  const whatsapp = optionalText(body.whatsapp, "WhatsApp number", 32);
  if (whatsapp && !/^\+?[0-9 ()-]{6,31}$/.test(whatsapp)) throw new HttpError(400, "Enter a valid WhatsApp number.");
  const value = {
    ...DEFAULT_BUSINESS,
    phone: validPhone(body.phone),
    email: validEmail(body.email),
    whatsapp,
    address: optionalText(body.address, "Business address", 500),
    updatedAt: new Date().toISOString()
  };
  const existing = await getRow(req, TABLES.settings, "business");
  await (existing
    ? updateRow(req, TABLES.settings, "business", value)
    : createRow(req, TABLES.settings, "business", value));
  return { settings: value };
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, "Choose a valid appointment date.");
  }
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, "Choose a valid appointment date.");
  }
  return value;
}

function timeToMinutes(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new HttpError(400, "Choose a valid 24-hour appointment time.");
  }
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function timezoneOffsetMinutes(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(instant);
  const zone = parts.find(part => part.type === "timeZoneName")?.value || "GMT";
  const match = zone.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === "-" ? -minutes : minutes;
}

function localDateTimeToUtc(date, time, timeZone) {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const wallTime = Date.UTC(year, month - 1, day, hours, minutes);
  const initialOffset = timezoneOffsetMinutes(new Date(wallTime), timeZone);
  let utc = wallTime - initialOffset * 60000;
  const correctedOffset = timezoneOffsetMinutes(new Date(utc), timeZone);
  if (correctedOffset !== initialOffset) utc = wallTime - correctedOffset * 60000;
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(utc));
  const values = Object.fromEntries(local.map(part => [part.type, part.value]));
  if (`${values.year}-${values.month}-${values.day}` !== date || `${values.hour}:${values.minute}` !== time) {
    throw new HttpError(400, "That local appointment time does not exist.");
  }
  return new Date(utc);
}

function localDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function weekday(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function hoursForDate(openingHours, date) {
  const hours = openingHours[String(weekday(date))];
  if (!hours || hours.closed === true || !hours.open || !hours.close) return null;
  const open = timeToMinutes(hours.open);
  const close = timeToMinutes(hours.close);
  if (close <= open) throw new HttpError(503, "Configured salon opening hours are invalid.");
  return { open, close };
}

async function salonConfig(req) {
  const config = await setting(req, "salon", null);
  if (!config) throw new HttpError(503, "Salon settings are not configured.");
  return {
    timezone: config.timezone || "Africa/Lagos",
    openingHours: config.openingHours || {},
    slotIntervalMinutes: Number(config.slotIntervalMinutes) || 30
  };
}

async function serviceById(req, id, includeInactive = false) {
  const service = await getRow(req, TABLES.services, validId(id, "Service"));
  if (!service || (!includeInactive && service.isActive === false)) {
    throw new HttpError(404, "Salon service not found.");
  }
  return service;
}

function slotIds(startsAt, endsAt) {
  const quantum = 5 * 60 * 1000;
  const first = Math.floor(new Date(startsAt).getTime() / quantum);
  const last = Math.ceil(new Date(endsAt).getTime() / quantum);
  const ids = [];
  for (let slot = first; slot < last; slot++) ids.push(`s-${slot}`);
  return ids;
}

async function activeAppointments(req) {
  return (await listRows(req, TABLES.appointments))
    .filter(appointment => ACTIVE_APPOINTMENT_STATUSES.has(appointment.status));
}

async function activeSlots(req) {
  const now = Date.now();
  return (await listRows(req, TABLES.slots))
    .filter(slot => !slot.expiresAt || new Date(slot.expiresAt).getTime() > now);
}

async function createReservationSlot(req, id, appointmentId, expiresAt) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await createRow(req, TABLES.slots, id, { appointmentId, expiresAt });
      return id;
    } catch (error) {
      if (error.status !== 409) throw error;
      const existing = await getRow(req, TABLES.slots, id);
      if (existing?.expiresAt && new Date(existing.expiresAt).getTime() <= Date.now()) {
        await deleteRow(req, TABLES.slots, id);
        continue;
      }
      if (existing?.appointmentId === appointmentId) return "";
      throw new HttpError(409, "That appointment time was just taken. Choose another available time.");
    }
  }
  throw new HttpError(409, "That appointment time was just taken. Choose another available time.");
}

async function reserveSlots(req, appointmentId, startsAt, endsAt) {
  const ids = slotIds(startsAt, endsAt);
  const created = [];
  const expiresAt = new Date(new Date(endsAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
  for (let offset = 0; offset < ids.length; offset += 8) {
    const batch = await Promise.allSettled(ids.slice(offset, offset + 8)
      .map(id => createReservationSlot(req, id, appointmentId, expiresAt)));
    created.push(...batch
      .filter(result => result.status === "fulfilled" && result.value)
      .map(result => result.value));
    const failure = batch.find(result => result.status === "rejected");
    if (failure) {
      await Promise.all(created.map(id => deleteRow(req, TABLES.slots, id)));
      throw failure.reason;
    }
  }
  return { ids, created };
}

async function releaseSlots(req, appointmentId, keepIds = new Set()) {
  const slots = await listRows(req, TABLES.slots);
  await Promise.all(slots
    .filter(slot => slot.appointmentId === appointmentId && !keepIds.has(slot.id))
    .map(slot => deleteRow(req, TABLES.slots, slot.id)));
}

function appointmentToResponse(appointment, timezone) {
  return {
    id: appointment.id,
    reference: appointment.reference,
    service_id: appointment.serviceId,
    service_name: appointment.serviceName,
    price_minor: Math.round(Number(appointment.price || 0) * 100),
    duration_minutes: appointment.durationMinutes,
    customer_name: appointment.customerName,
    customer_email: appointment.customerEmail,
    customer_phone: appointment.customerPhone,
    starts_at: appointment.startsAt,
    ends_at: appointment.endsAt,
    status: appointment.status,
    created_at: appointment.createdAt,
    updated_at: appointment.updatedAt,
    timezone
  };
}

async function availableTimes(req, service, date) {
  const config = await salonConfig(req);
  const day = validDate(date);
  if (day < localDateParts(new Date(), config.timezone)) return [];
  const hours = hoursForDate(config.openingHours, day);
  if (!hours) return [];
  const interval = config.slotIntervalMinutes;
  const times = [];
  const first = localDateTimeToUtc(day,
    `${String(Math.floor(hours.open / 60)).padStart(2, "0")}:${String(hours.open % 60).padStart(2, "0")}`,
    config.timezone);
  const close = localDateTimeToUtc(day,
    `${String(Math.floor(hours.close / 60)).padStart(2, "0")}:${String(hours.close % 60).padStart(2, "0")}`,
    config.timezone);
  const bookings = await activeAppointments(req);
  const locks = new Set((await activeSlots(req)).map(slot => slot.id));
  for (let start = hours.open; start + service.durationMinutes <= hours.close; start += interval) {
    const time = `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`;
    const startsAt = localDateTimeToUtc(day, time, config.timezone);
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60000);
    if (startsAt.getTime() <= Date.now()) continue;
    if (startsAt < close && endsAt > first) {
      const startIso = startsAt.toISOString();
      const endIso = endsAt.toISOString();
      if (bookings.some(item => item.startsAt < endIso && item.endsAt > startIso)) continue;
      if (slotIds(startIso, endIso).some(id => locks.has(id))) continue;
    }
    times.push(time);
  }
  return times;
}

function appointmentReference() {
  return `KNB-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

async function createAppointment(req, body) {
  const customerName = requiredText(body.customerName, "Name", 120);
  const customerEmail = validEmail(body.customerEmail);
  const customerPhone = validPhone(body.customerPhone);
  if (!customerEmail && !customerPhone) throw new HttpError(400, "Provide a phone number or email address.");
  const service = await serviceById(req, body.serviceId);
  const day = validDate(body.date);
  const time = requiredText(body.time, "Appointment time", 5);
  const config = await salonConfig(req);
  if (day < localDateParts(new Date(), config.timezone)) throw new HttpError(400, "Appointments cannot be booked in the past.");
  const startMinute = timeToMinutes(time);
  const hours = hoursForDate(config.openingHours, day);
  if (!hours || startMinute < hours.open || startMinute + service.durationMinutes > hours.close ||
      (startMinute - hours.open) % config.slotIntervalMinutes !== 0) {
    throw new HttpError(400, "That time is outside the configured salon hours.");
  }
  const startsAt = localDateTimeToUtc(day, time, config.timezone);
  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60000);
  if (startsAt.getTime() <= Date.now()) throw new HttpError(400, "Appointments cannot be booked in the past.");
  const startIso = startsAt.toISOString();
  const endIso = endsAt.toISOString();
  const current = await activeAppointments(req);
  if (current.some(item => item.startsAt < endIso && item.endsAt > startIso)) {
    throw new HttpError(409, "That appointment time was just taken. Choose another available time.");
  }
  const id = crypto.randomUUID();
  const appointment = {
    reference: appointmentReference(),
    serviceId: service.id,
    serviceName: service.name,
    price: price(service.price, "Price"),
    durationMinutes: service.durationMinutes,
    customerName,
    customerEmail,
    customerPhone,
    startsAt: startIso,
    endsAt: endIso,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const reservation = await reserveSlots(req, id, startIso, endIso);
  try {
    await createRow(req, TABLES.appointments, id, appointment);
  } catch (error) {
    await Promise.all(reservation.created.map(slotId => deleteRow(req, TABLES.slots, slotId)));
    throw error;
  }
  return appointmentToResponse({ id, ...appointment }, config.timezone);
}

async function adminAppointments(req, url) {
  const status = url.searchParams.get("status");
  if (status && !["pending", "confirmed", "cancelled", "completed"].includes(status)) {
    throw new HttpError(400, "Unknown appointment status.");
  }
  const query = (url.searchParams.get("q") || "").trim().toLowerCase();
  const config = await salonConfig(req);
  let items = await listRows(req, TABLES.appointments);
  if (status) items = items.filter(item => item.status === status);
  if (query) {
    items = items.filter(item =>
      [item.reference, item.customerName, item.customerPhone, item.customerEmail]
        .some(value => String(value || "").toLowerCase().includes(query)));
  }
  items.sort((a, b) => {
    const now = Date.now();
    const aTime = new Date(a.startsAt).getTime();
    const bTime = new Date(b.startsAt).getTime();
    const aFuture = aTime >= now;
    const bFuture = bTime >= now;
    return aFuture !== bFuture ? (aFuture ? -1 : 1) : aFuture ? aTime - bTime : bTime - aTime;
  });
  return { appointments: items.slice(0, 500).map(item => appointmentToResponse(item, config.timezone)) };
}

async function updateAppointment(req, id, body) {
  const appointment = await getRow(req, TABLES.appointments, id);
  if (!appointment) throw new HttpError(404, "Appointment not found.");
  const status = body.status;
  if (status != null && !["pending", "confirmed", "cancelled", "completed"].includes(status)) {
    throw new HttpError(400, "Choose a valid appointment status.");
  }
  let service = {
    id: appointment.serviceId,
    name: appointment.serviceName,
    price: appointment.price,
    durationMinutes: appointment.durationMinutes
  };
  let startsAt = appointment.startsAt;
  let endsAt = appointment.endsAt;
  const isReschedule = body.date != null || body.time != null || body.serviceId != null;
  if (isReschedule) {
    const serviceId = body.serviceId || appointment.serviceId;
    service = await serviceById(req, serviceId, true);
    if (service.id !== appointment.serviceId && service.isActive === false) {
      throw new HttpError(400, "A new appointment cannot be scheduled with an inactive service.");
    }
    const config = await salonConfig(req);
    const day = validDate(body.date);
    const time = requiredText(body.time, "Appointment time", 5);
    const minutes = timeToMinutes(time);
    const hours = hoursForDate(config.openingHours, day);
    if (!hours || minutes < hours.open || minutes + service.durationMinutes > hours.close ||
        (minutes - hours.open) % config.slotIntervalMinutes !== 0) {
      throw new HttpError(400, "The new time is outside the configured salon hours.");
    }
    const start = localDateTimeToUtc(day, time, config.timezone);
    if (start.getTime() <= Date.now()) throw new HttpError(400, "Appointments cannot be rescheduled into the past.");
    startsAt = start.toISOString();
    endsAt = new Date(start.getTime() + service.durationMinutes * 60000).toISOString();
  }
  const nextStatus = status || appointment.status;
  if (nextStatus === "completed" && new Date(endsAt).getTime() > Date.now()) {
    throw new HttpError(400, "An appointment can only be completed after its scheduled end.");
  }
  const config = await salonConfig(req);
  let reservation = { ids: [], created: [] };
  if (ACTIVE_APPOINTMENT_STATUSES.has(nextStatus)) {
    const overlapping = (await activeAppointments(req)).some(other =>
      other.id !== id && other.startsAt < endsAt && other.endsAt > startsAt);
    if (overlapping) throw new HttpError(409, "That appointment time conflicts with another booking.");
    reservation = await reserveSlots(req, id, startsAt, endsAt);
  }
  const updated = {
    ...appointment,
    serviceId: service.id,
    serviceName: service.name,
    price: isReschedule ? price(service.price, "Price") : appointment.price,
    durationMinutes: isReschedule ? service.durationMinutes : appointment.durationMinutes,
    startsAt,
    endsAt,
    status: nextStatus,
    updatedAt: new Date().toISOString()
  };
  try {
    await updateRow(req, TABLES.appointments, id, updated);
  } catch (error) {
    await Promise.all(reservation.created.map(slotId => deleteRow(req, TABLES.slots, slotId)));
    throw error;
  }
  await releaseSlots(req, id, ACTIVE_APPOINTMENT_STATUSES.has(nextStatus) ? new Set(reservation.ids) : new Set());
  return { appointment: appointmentToResponse({ id, ...updated }, config.timezone) };
}

function requestBody(req) {
  if (req.bodyJson && typeof req.bodyJson === "object" && !Array.isArray(req.bodyJson)) return req.bodyJson;
  throw new HttpError(400, "A valid JSON object is required.");
}

async function route(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();

  if (path === "/api/health" && method === "GET") return { status: "ok" };
  if (path === "/api/products" && method === "GET") return products(req, url);
  const publicProduct = path.match(/^\/api\/products\/([^/]+)$/);
  if (publicProduct && method === "GET") return products(req, url, decodeURIComponent(publicProduct[1]));
  if (path === "/api/categories" && method === "GET") return categories(req, url.searchParams.get("type") || "");
  if (path === "/api/services" && method === "GET") return services(req);
  if (path === "/api/settings" && method === "GET") return publicSettings(req);
  if (path === "/api/availability" && method === "GET") {
    const service = await serviceById(req, requiredText(url.searchParams.get("serviceId"), "Service", 80));
    const date = validDate(url.searchParams.get("date"));
    const settings = await salonConfig(req);
    return { date, timezone: settings.timezone, times: await availableTimes(req, service, date) };
  }
  if (path === "/api/appointments" && method === "POST") {
    return withStatus({ appointment: await createAppointment(req, requestBody(req)) }, 201);
  }

  const admin = path.startsWith("/api/admin/");
  if (admin) {
    const user = await requireAdmin(req);
    if (path === "/api/admin/auth/session" && method === "GET") return { admin: user };
    if (path === "/api/admin/auth/logout" && method === "POST") return { ok: true };
    if (path === "/api/admin/images" && method === "POST") {
      return withStatus(await uploadProductImages(req), 201);
    }

    if (path === "/api/admin/products" && method === "GET") return products(req, url);
    if (path === "/api/admin/products" && method === "POST") {
      return withStatus(await saveProduct(req, requestBody(req)), 201);
    }
    const productMatch = path.match(/^\/api\/admin\/products\/([^/]+)$/);
    if (productMatch) {
      const id = validId(decodeURIComponent(productMatch[1]));
      if (method === "PUT") return saveProduct(req, requestBody(req), id);
      if (method === "DELETE") {
        if (!await getRow(req, TABLES.products, id)) throw new HttpError(404, "Product not found.");
        await deleteRow(req, TABLES.products, id);
        return { ok: true };
      }
    }

    if (path === "/api/admin/categories" && method === "GET") return categories(req);
    if (path === "/api/admin/categories" && method === "POST") {
      return withStatus(await saveCategory(req, requestBody(req)), 201);
    }
    const categoryMatch = path.match(/^\/api\/admin\/categories\/([^/]+)$/);
    if (categoryMatch) {
      const id = validId(decodeURIComponent(categoryMatch[1]));
      if (method === "PUT") return saveCategory(req, requestBody(req), id);
      if (method === "DELETE") {
        if ((await listRows(req, TABLES.products)).some(item => item.categoryId === id)) {
          throw new HttpError(409, "Move or delete this category's products before deleting it.");
        }
        if (!await getRow(req, TABLES.categories, id)) throw new HttpError(404, "Category not found.");
        await deleteRow(req, TABLES.categories, id);
        return { ok: true };
      }
    }

    if (path === "/api/admin/services" && method === "GET") return services(req, false);
    if (path === "/api/admin/services" && method === "POST") {
      return withStatus(await saveService(req, requestBody(req)), 201);
    }
    const serviceMatch = path.match(/^\/api\/admin\/services\/([^/]+)$/);
    if (serviceMatch) {
      const id = validId(decodeURIComponent(serviceMatch[1]));
      if (method === "PUT") return saveService(req, requestBody(req), id);
      if (method === "DELETE") {
        if (!await getRow(req, TABLES.services, id)) throw new HttpError(404, "Salon service not found.");
        await deleteRow(req, TABLES.services, id);
        return { ok: true };
      }
    }

    if (path === "/api/admin/salon-settings" && method === "GET") {
      return { settings: await setting(req, "salon", { timezone: "Africa/Lagos", openingHours: {}, slotIntervalMinutes: 30 }) };
    }
    if (path === "/api/admin/salon-settings" && method === "PUT") return updateSalonSettings(req, requestBody(req));
    if (path === "/api/admin/settings" && method === "GET") return publicSettings(req);
    if (path === "/api/admin/settings" && method === "PUT") return updateBusinessSettings(req, requestBody(req));
    if (path === "/api/admin/appointments" && method === "GET") return adminAppointments(req, url);
    const appointmentMatch = path.match(/^\/api\/admin\/appointments\/([^/]+)$/);
    if (appointmentMatch && method === "PUT") {
      return updateAppointment(req, validId(decodeURIComponent(appointmentMatch[1])), requestBody(req));
    }
    throw new HttpError(404, "Admin endpoint not found.");
  }

  throw new HttpError(404, "Endpoint not found.");
}

export async function handler(context) {
  const { req, res, error } = context;
  let headers = {};
  try {
    headers = corsHeaders(req);
    if (req.method.toUpperCase() === "OPTIONS") return res.text("", 204, headers);
    const result = await route(req);
    return res.json(result?.[HTTP_STATUS] ? result.body : result, result?.[HTTP_STATUS] || 200, headers);
  } catch (cause) {
    const status = cause instanceof HttpError ? cause.status : 500;
    if (status >= 500) error(`KNB API failed: ${cause.message}`);
    return res.json({ error: status === 500 ? "The request could not be completed." : cause.message }, status, headers);
  }
}

export default handler;
