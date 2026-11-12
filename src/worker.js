const SESSION_COOKIE = "__Host-kmb_session";
const ACTIVE_APPOINTMENT_STATUSES = ["pending", "confirmed"];
const MAX_JSON_BYTES = 1024 * 1024;
const DEFAULT_TIMEZONE = "Africa/Lagos";
const PASSWORD_ITERATIONS = 210000;
const STOREFRONT_ORIGIN = "https://knb-exceptional.vercel.app";
const CORS_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const CORS_HEADERS = ["content-type"];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers
    }
  });
}

function randomId() {
  return crypto.randomUUID();
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function hashPassword(password, salt, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function verifyPassword(password, encoded) {
  const parts = typeof encoded === "string" ? encoded.split("$") : [];
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 600000) return false;
  try {
    const expected = base64UrlToBytes(parts[3]);
    const actual = await hashPassword(password, base64UrlToBytes(parts[2]), iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function digestToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToBase64Url(new Uint8Array(digest));
}

function cookieValue(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}

function cookieHeader(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function originAllowed(origin, request, env) {
  if (!origin) return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin !== origin) return false;
  const allowed = new Set([
    STOREFRONT_ORIGIN,
    ...(env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean)
  ]);
  return parsed.origin === new URL(request.url).origin || allowed.has(parsed.origin);
}

function checkOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) throw new HttpError(403, "A same-origin request is required.");
  if (!originAllowed(origin, request, env)) throw new HttpError(403, "This origin is not allowed.");
  return origin;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!originAllowed(origin, request, env)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": CORS_METHODS.join(", "),
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}

function requireDb(env) {
  if (!env.DB) throw new HttpError(503, "The database is not configured.");
  return env.DB;
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_JSON_BYTES) throw new HttpError(413, "Request body is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) throw new HttpError(413, "Request body is too large.");
  try {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("Object expected.");
    return value;
  } catch {
    throw new HttpError(400, "A valid JSON object is required.");
  }
}

function requiredText(value, field, max = 200) {
  if (typeof value !== "string") throw new HttpError(400, `${field} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new HttpError(400, `${field} must be between 1 and ${max} characters.`);
  return normalized;
}

function optionalText(value, field, max = 10000) {
  if (value == null) return "";
  if (typeof value !== "string" || value.trim().length > max) throw new HttpError(400, `${field} is invalid.`);
  return value.trim();
}

function priceToMinor(value, field, nullable = false) {
  if (nullable && (value === null || value === "" || value === undefined)) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000000000) throw new HttpError(400, `${field} must be a non-negative price.`);
  return Math.round(number * 100);
}

function parseJsonArray(value, field, maxItems = 40, maxLength = 100) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new HttpError(400, `${field} must be a list.`);
  return value.map(item => requiredText(item, field, maxLength));
}

function toProduct(row) {
  const gallery = safeArray(row.gallery_json).map(publicStaticImagePath).filter(Boolean);
  const imageKey = publicStaticImagePath(row.main_image_key) || gallery[0] || "";
  const imageUrl = path => path || "";
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category_name,
    categoryId: row.category_id,
    categoryType: row.category_type,
    price: row.price_minor / 100,
    oldPrice: row.old_price_minor == null ? null : row.old_price_minor / 100,
    image: imageUrl(imageKey),
    imageKey,
    images: [imageKey, ...gallery.filter(key => key !== imageKey)].filter(Boolean).map(imageUrl),
    imageKeys: [imageKey, ...gallery.filter(key => key !== imageKey)].filter(Boolean),
    description: row.description,
    longDescription: row.long_description,
    inStock: Boolean(row.in_stock),
    dateAdded: row.created_at,
    tag: row.tag,
    rating: 0,
    reviewCount: 0,
    sizes: safeArray(row.sizes_json),
    colors: safeArray(row.colors_json),
    material: row.material,
    condition: row.condition,
    origin: row.origin
  };
}

function safeArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function publicStaticImagePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "";
  try {
    // Legacy R2 keys remain in D1 but must not be emitted as broken media URLs.
    return validateStaticImagePath(value) || "";
  } catch (error) {
    if (error instanceof HttpError) return "";
    throw error;
  }
}

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, c.category_type,
    (SELECT json_group_array(pi.object_key)
      FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order) AS gallery_json
  FROM products p JOIN categories c ON c.id = p.category_id`;

async function listProducts(db, url) {
  const where = [];
  const values = [];
  const type = url.searchParams.get("type");
  if (type) {
    if (type !== "collectibles" && type !== "beauty") throw new HttpError(400, "Unknown product collection.");
    where.push("c.category_type = ?");
    values.push(type);
  }
  const categoryId = url.searchParams.get("categoryId");
  if (categoryId) {
    where.push("p.category_id = ?");
    values.push(requiredText(categoryId, "Category", 80));
  }
  const query = url.searchParams.get("q");
  if (query) {
    const search = requiredText(query, "Search", 100);
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\')");
    const escaped = search.replace(/[\\%_]/g, "\\$&");
    values.push(`%${escaped}%`, `%${escaped}%`);
  }
  const sql = `${PRODUCT_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY p.created_at DESC LIMIT 500`;
  const result = await db.prepare(sql).bind(...values).all();
  return (result.results || []).map(toProduct);
}

function validId(id) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new HttpError(400, "Invalid record ID.");
  return id;
}

function slugify(value) {
  return value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
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

function localDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function validDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Choose a valid appointment date.");
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new HttpError(400, "Choose a valid appointment date.");
  return date;
}

function timeToMinutes(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new HttpError(400, "Opening hours must use 24-hour HH:MM times.");
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

function weekday(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function getHoursForDate(openingHours, date) {
  const hours = openingHours[String(weekday(date))];
  if (!hours || hours.closed === true || !hours.open || !hours.close) return null;
  const open = timeToMinutes(hours.open);
  const close = timeToMinutes(hours.close);
  if (close <= open) throw new HttpError(500, "Configured salon opening hours are invalid.");
  return { open, close };
}

async function salonConfig(db) {
  const row = await db.prepare("SELECT timezone, opening_hours_json, slot_interval_minutes FROM salon_settings WHERE id = 1").first();
  if (!row) throw new HttpError(503, "Salon settings are not configured.");
  let openingHours;
  try {
    openingHours = JSON.parse(row.opening_hours_json);
  } catch {
    throw new HttpError(503, "Salon opening hours are not configured correctly.");
  }
  return {
    timezone: row.timezone || DEFAULT_TIMEZONE,
    openingHours,
    slotIntervalMinutes: row.slot_interval_minutes
  };
}

async function serviceById(db, id, includeInactive = false) {
  const sql = `SELECT * FROM salon_services WHERE id = ?${includeInactive ? "" : " AND is_active = 1"}`;
  const service = await db.prepare(sql).bind(validId(id)).first();
  if (!service) throw new HttpError(404, "Salon service not found.");
  return service;
}

async function overlaps(db, startsAt, endsAt, excludeId = "") {
  const result = await db.prepare(`
    SELECT id FROM appointments
    WHERE status IN ('pending', 'confirmed')
      AND starts_at < ? AND ends_at > ?
      AND (? = '' OR id != ?)
    LIMIT 1
  `).bind(endsAt, startsAt, excludeId, excludeId).first();
  return Boolean(result);
}

async function availableTimes(db, service, date) {
  const config = await salonConfig(db);
  const day = validDate(date);
  if (day < localDateParts(new Date(), config.timezone)) return [];
  const hours = getHoursForDate(config.openingHours, day);
  if (!hours) return [];
  const interval = config.slotIntervalMinutes;
  const times = [];
  const now = Date.now();
  const firstSlot = localDateTimeToUtc(day, `${String(Math.floor(hours.open / 60)).padStart(2, "0")}:${String(hours.open % 60).padStart(2, "0")}`, config.timezone);
  const closingTime = localDateTimeToUtc(day, `${String(Math.floor(hours.close / 60)).padStart(2, "0")}:${String(hours.close % 60).padStart(2, "0")}`, config.timezone);
  const existingResult = await db.prepare(`
    SELECT starts_at, ends_at FROM appointments
    WHERE status IN ('pending', 'confirmed') AND starts_at < ? AND ends_at > ?
  `).bind(closingTime.toISOString(), firstSlot.toISOString()).all();
  const existing = existingResult.results || [];
  for (let start = hours.open; start + service.duration_minutes <= hours.close; start += interval) {
    const value = `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`;
    const startsAt = localDateTimeToUtc(day, value, config.timezone);
    const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60000);
    if (startsAt.getTime() <= now) continue;
    const startIso = startsAt.toISOString();
    const endIso = endsAt.toISOString();
    if (!existing.some(booking => booking.starts_at < endIso && booking.ends_at > startIso)) times.push(value);
  }
  return times;
}

function appointmentReference() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `KNB-${bytesToBase64Url(bytes).toUpperCase()}`;
}

async function createAppointment(db, body) {
  const customerName = requiredText(body.customerName, "Name", 120);
  const customerEmail = validEmail(body.customerEmail);
  const customerPhone = validPhone(body.customerPhone);
  if (!customerEmail && !customerPhone) throw new HttpError(400, "Provide a phone number or email address.");
  const service = await serviceById(db, body.serviceId);
  const day = validDate(body.date);
  const time = body.time;
  const config = await salonConfig(db);
  if (day < localDateParts(new Date(), config.timezone)) throw new HttpError(400, "Appointments cannot be booked in the past.");
  const startMinute = timeToMinutes(time);
  const hours = getHoursForDate(config.openingHours, day);
  if (!hours || startMinute < hours.open || startMinute + service.duration_minutes > hours.close ||
      (startMinute - hours.open) % config.slotIntervalMinutes !== 0) {
    throw new HttpError(400, "That time is outside the configured salon hours.");
  }
  const startsAt = localDateTimeToUtc(day, time, config.timezone);
  const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60000);
  if (startsAt.getTime() <= Date.now()) throw new HttpError(400, "Appointments cannot be booked in the past.");
  const id = randomId();
  const reference = appointmentReference();
  const inserted = await db.prepare(`
    INSERT INTO appointments (
      id, reference, service_id, service_name, price_minor, duration_minutes,
      customer_name, customer_email, customer_phone, starts_at, ends_at, status
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending'
    WHERE NOT EXISTS (
      SELECT 1 FROM appointments
      WHERE status IN ('pending', 'confirmed') AND starts_at < ? AND ends_at > ?
    )
    RETURNING id, reference, service_name, starts_at, ends_at, status
  `).bind(
    id, reference, service.id, service.name, service.price_minor, service.duration_minutes,
    customerName, customerEmail, customerPhone, startsAt.toISOString(), endsAt.toISOString(),
    endsAt.toISOString(), startsAt.toISOString()
  ).first();
  if (!inserted) throw new HttpError(409, "That appointment time was just taken. Choose another available time.");
  return { ...inserted, timezone: config.timezone };
}

async function requireAdmin(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || token.length > 200) throw new HttpError(401, "Please sign in as an administrator.");
  const db = requireDb(env);
  const tokenHash = await digestToken(token);
  const session = await db.prepare(`
    SELECT a.id, a.email
    FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND a.is_active = 1
  `).bind(tokenHash, new Date().toISOString()).first();
  if (!session) throw new HttpError(401, "Your administrator session has expired.");
  return session;
}

function settingValue(rows, key) {
  return rows.find(row => row.setting_key === key)?.setting_value || "";
}

async function publicSettings(db) {
  const [site, salon] = await Promise.all([
    db.prepare("SELECT setting_key, setting_value FROM site_settings").all(),
    salonConfig(db)
  ]);
  const rows = site.results || [];
  return {
    businessName: "KNB EXCEPTIONALS",
    phone: settingValue(rows, "contact_phone") || "+2348034269134",
    email: settingValue(rows, "contact_email") || "iderakayode@gmail.com",
    whatsapp: settingValue(rows, "whatsapp_number") || "+2348034269134",
    address: settingValue(rows, "business_address") || "C5 & C6, Run Shopping Complex, opposite Queen Esther, behind Tantalizers, Redemption City of God, Mowe, Ogun State.",
    tiktokDisplayName: "Idera Kayode (KNB Exceptional)",
    timezone: salon.timezone,
    openingHours: salon.openingHours
  };
}

function validateHours(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Opening hours must include all seven days.");
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
    if (timeToMinutes(close) <= timeToMinutes(open)) throw new HttpError(400, "Closing time must be after opening time.");
    result[String(day)] = { open, close, closed: false };
  }
  return result;
}

function validateStaticImagePath(value) {
  if (value == null || value === "") return null;
  const path = requiredText(value, "Image path", 2048);
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[?#\u0000-\u001f]/.test(path)) {
    throw new HttpError(400, "Image paths must be root-relative website paths.");
  }
  const segments = path.slice(1).split("/");
  if (!segments.length || segments.some(segment => !segment)) throw new HttpError(400, "Image path is invalid.");
  let decodedSegments;
  try {
    decodedSegments = segments.map(segment => decodeURIComponent(segment));
  } catch {
    throw new HttpError(400, "Image path is invalid.");
  }
  if (decodedSegments.some(segment =>
    segment === "." || segment === ".." || segment.includes("%") || /[\/\\\u0000-\u001f]/.test(segment)
  ) || !/\.(jpe?g|png|webp)$/i.test(decodedSegments[decodedSegments.length - 1])) {
    throw new HttpError(400, "Use a safe website image path ending in .jpg, .jpeg, .png, or .webp.");
  }
  if (path.startsWith("/api/")) throw new HttpError(400, "Image paths must point to static website files.");
  return path;
}

async function saveProduct(db, body, id = "") {
  const name = requiredText(body.name, "Product name", 180);
  const categoryId = validId(requiredText(body.categoryId, "Product category", 80));
  const category = await db.prepare("SELECT id FROM categories WHERE id = ?").bind(categoryId).first();
  if (!category) throw new HttpError(400, "Choose an existing product category.");
  const price = priceToMinor(body.price, "Price");
  const oldPrice = priceToMinor(body.oldPrice, "Old price", true);
  const tag = body.tag == null || body.tag === "" ? null : body.tag;
  if (tag !== null && tag !== "new" && tag !== "sale") throw new HttpError(400, "Choose a valid product tag.");
  const description = optionalText(body.description, "Description", 2000);
  const longDescription = optionalText(body.longDescription, "Full description", 10000);
  const material = optionalText(body.material, "Material", 120);
  const condition = optionalText(body.condition, "Condition", 120);
  const origin = optionalText(body.origin, "Origin", 120);
  if (body.inStock != null && typeof body.inStock !== "boolean") throw new HttpError(400, "Availability must be true or false.");
  const inStock = body.inStock === false ? 0 : 1;
  const sizes = parseJsonArray(body.sizes, "Sizes");
  const colors = parseJsonArray(body.colors, "Colors", 40, 30);
  const mainImageKey = validateStaticImagePath(body.mainImageKey);
  const galleryKeys = body.galleryImageKeys == null
    ? []
    : parseJsonArray(body.galleryImageKeys, "Gallery image paths", 40, 2048).map(validateStaticImagePath);
  if (new Set(galleryKeys).size !== galleryKeys.length || (mainImageKey && galleryKeys.includes(mainImageKey))) {
    throw new HttpError(400, "Product images must be unique.");
  }
  const now = new Date().toISOString();
  const productId = id || randomId();
  const slug = `${slugify(name) || "product"}-${productId.slice(0, 8)}`;
  if (id && !(await db.prepare("SELECT id FROM products WHERE id = ?").bind(id).first())) {
    throw new HttpError(404, "Product not found.");
  }
  const statements = [];
  if (id) {
    statements.push(db.prepare(`
      UPDATE products SET category_id = ?, name = ?, slug = ?, description = ?, long_description = ?,
        price_minor = ?, old_price_minor = ?, tag = ?, material = ?, condition = ?, origin = ?,
        in_stock = ?, main_image_key = ?, sizes_json = ?, colors_json = ?, updated_at = ?
      WHERE id = ?
    `).bind(categoryId, name, slug, description, longDescription, price, oldPrice, tag, material,
      condition, origin, inStock, mainImageKey, JSON.stringify(sizes), JSON.stringify(colors), now, id));
    statements.push(db.prepare("DELETE FROM product_images WHERE product_id = ?").bind(id));
  } else {
    statements.push(db.prepare(`
      INSERT INTO products (id, category_id, name, slug, description, long_description,
        price_minor, old_price_minor, tag, material, condition, origin, in_stock,
        main_image_key, sizes_json, colors_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(productId, categoryId, name, slug, description, longDescription, price, oldPrice, tag,
      material, condition, origin, inStock, mainImageKey, JSON.stringify(sizes), JSON.stringify(colors), now, now));
  }
  for (let index = 0; index < galleryKeys.length; index++) {
    statements.push(db.prepare("INSERT INTO product_images (id, product_id, object_key, sort_order) VALUES (?, ?, ?, ?)")
      .bind(randomId(), productId, galleryKeys[index], index));
  }
  await db.batch(statements);
  const row = await db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).bind(productId).first();
  return toProduct(row);
}

async function deleteProduct(db, id) {
  const result = await db.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
  if (!result.meta?.changes) throw new HttpError(404, "Product not found.");
}

function toService(row) {
  const imageKey = publicStaticImagePath(row.image_key);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price_minor / 100,
    durationMinutes: row.duration_minutes,
    image: imageKey,
    imageKey,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at
  };
}

function servicePayload(body) {
  const name = requiredText(body.name, "Service name", 180);
  const description = optionalText(body.description, "Description", 4000);
  const price = priceToMinor(body.price, "Price");
  const durationMinutes = Number(body.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 720) {
    throw new HttpError(400, "Duration must be between 1 and 720 minutes.");
  }
  if (body.isActive != null && typeof body.isActive !== "boolean") throw new HttpError(400, "Service availability must be true or false.");
  const imageKey = validateStaticImagePath(body.imageKey);
  return { name, description, price, durationMinutes, imageKey, isActive: body.isActive === false ? 0 : 1 };
}

async function adminAppointments(db, url) {
  const status = url.searchParams.get("status");
  if (status && !["pending", "confirmed", "cancelled", "completed"].includes(status)) throw new HttpError(400, "Unknown appointment status.");
  const where = [];
  const values = [];
  if (status) {
    where.push("a.status = ?");
    values.push(status);
  }
  const search = url.searchParams.get("q");
  if (search) {
    const query = `%${requiredText(search, "Search", 100)}%`;
    where.push("(a.reference LIKE ? OR a.customer_name LIKE ? OR a.customer_phone LIKE ? OR a.customer_email LIKE ?)");
    values.push(query, query, query, query);
  }
  const result = await db.prepare(`
    SELECT a.*, s.name AS current_service_name
    FROM appointments a LEFT JOIN salon_services s ON s.id = a.service_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY CASE WHEN a.starts_at >= ? THEN 0 ELSE 1 END,
      CASE WHEN a.starts_at >= ? THEN a.starts_at END ASC,
      CASE WHEN a.starts_at < ? THEN a.starts_at END DESC
    LIMIT 500
  `).bind(...values, new Date().toISOString(), new Date().toISOString(), new Date().toISOString()).all();
  return result.results || [];
}

async function updateAppointment(db, id, body) {
  const appointment = await db.prepare("SELECT * FROM appointments WHERE id = ?").bind(id).first();
  if (!appointment) throw new HttpError(404, "Appointment not found.");
  const status = body.status;
  if (status != null && !["pending", "confirmed", "cancelled", "completed"].includes(status)) {
    throw new HttpError(400, "Choose a valid appointment status.");
  }
  let startsAt = appointment.starts_at;
  let endsAt = appointment.ends_at;
  let service = {
    id: appointment.service_id,
    name: appointment.service_name,
    price_minor: appointment.price_minor,
    duration_minutes: appointment.duration_minutes
  };
  const isReschedule = body.date != null || body.time != null || body.serviceId != null;
  if (isReschedule) {
    if (body.serviceId || appointment.service_id) {
      service = await serviceById(db, body.serviceId || appointment.service_id, true);
    }
    if (!service.is_active && service.id !== appointment.service_id) throw new HttpError(400, "That service is not available for new appointments.");
    const config = await salonConfig(db);
    const day = validDate(body.date);
    const time = requiredText(body.time, "Appointment time", 5);
    const minutes = timeToMinutes(time);
    const hours = getHoursForDate(config.openingHours, day);
    if (!hours || minutes < hours.open || minutes + service.duration_minutes > hours.close ||
        (minutes - hours.open) % config.slotIntervalMinutes !== 0) {
      throw new HttpError(400, "The new time is outside the configured salon hours.");
    }
    const start = localDateTimeToUtc(day, time, config.timezone);
    if (start.getTime() <= Date.now()) throw new HttpError(400, "Appointments cannot be rescheduled into the past.");
    startsAt = start.toISOString();
    endsAt = new Date(start.getTime() + service.duration_minutes * 60000).toISOString();
  }
  const nextStatus = status || appointment.status;
  if (nextStatus === "completed" && new Date(endsAt).getTime() > Date.now()) {
    throw new HttpError(400, "An appointment can only be completed after its scheduled end.");
  }
  const now = new Date().toISOString();
  let updated;
  if (ACTIVE_APPOINTMENT_STATUSES.includes(nextStatus)) {
    updated = await db.prepare(`
      UPDATE appointments SET status = ?, service_id = ?, service_name = ?, price_minor = ?,
        duration_minutes = ?, starts_at = ?, ends_at = ?, updated_at = ?
      WHERE id = ? AND NOT EXISTS (
        SELECT 1 FROM appointments other
        WHERE other.id != appointments.id AND other.status IN ('pending', 'confirmed')
          AND other.starts_at < ? AND other.ends_at > ?
      )
      RETURNING *
    `).bind(nextStatus, service.id, service.name,
      isReschedule ? service.price_minor : appointment.price_minor,
      isReschedule ? service.duration_minutes : appointment.duration_minutes,
      startsAt, endsAt, now, id, endsAt, startsAt).first();
    if (!updated) throw new HttpError(409, "That appointment time conflicts with another booking.");
  } else {
    updated = await db.prepare(`
      UPDATE appointments SET status = ?, service_id = ?, service_name = ?, price_minor = ?,
        duration_minutes = ?, starts_at = ?, ends_at = ?, updated_at = ?
      WHERE id = ? RETURNING *
    `).bind(nextStatus, service.id, service.name,
      isReschedule ? service.price_minor : appointment.price_minor,
      isReschedule ? service.duration_minutes : appointment.duration_minutes,
      startsAt, endsAt, now, id).first();
  }
  return updated;
}

async function createSession(db, adminId, env) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToBase64Url(tokenBytes);
  const ttlHours = Math.max(1, Math.min(24, Number(env.SESSION_TTL_HOURS) || 12));
  const expiresAt = new Date(Date.now() + ttlHours * 3600000).toISOString();
  await db.prepare("INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)")
    .bind(await digestToken(token), adminId, expiresAt).run();
  return { token, expiresAt, maxAge: ttlHours * 3600 };
}

async function adminLogin(db, request, env) {
  const body = await readJson(request);
  const email = validEmail(body.email, true);
  if (typeof body.password !== "string" || !body.password.length || body.password.length > 1024) {
    throw new HttpError(400, "A valid password is required.");
  }
  const password = body.password;
  const admin = await db.prepare("SELECT id, email, password_hash FROM admins WHERE email = ? AND is_active = 1")
    .bind(email).first();
  const passwordMatches = admin ? await verifyPassword(password, admin.password_hash) : false;
  if (!admin || !passwordMatches) {
    console.warn("Admin login diagnostic", { adminFound: Boolean(admin), passwordMatches });
    throw new HttpError(401, "Email or password is incorrect.");
  }
  const session = await createSession(db, admin.id, env);
  return json({ admin: { id: admin.id, email: admin.email }, expiresAt: session.expiresAt }, 200, {
    "Set-Cookie": cookieHeader(session.token, session.maxAge)
  });
}

async function handleApi(request, env, url) {
  const db = requireDb(env);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (path === "/api/health" && method === "GET") return json({ status: "ok" });

  if (path === "/api/products" && method === "GET") {
    return json({ products: await listProducts(db, url) });
  }
  const productMatch = path.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch && method === "GET") {
    const identifier = decodeURIComponent(productMatch[1]);
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(identifier)) throw new HttpError(400, "Invalid product identifier.");
    const product = await db.prepare(`${PRODUCT_SELECT} WHERE p.id = ? OR p.slug = ?`)
      .bind(identifier, identifier).first();
    if (!product) throw new HttpError(404, "Product not found.");
    return json({ product: toProduct(product) });
  }
  if (path === "/api/categories" && method === "GET") {
    const type = url.searchParams.get("type");
    if (type && type !== "collectibles" && type !== "beauty") throw new HttpError(400, "Unknown category type.");
    const result = type
      ? await db.prepare("SELECT * FROM categories WHERE category_type = ? ORDER BY name").bind(type).all()
      : await db.prepare("SELECT * FROM categories ORDER BY category_type, name").all();
    return json({ categories: result.results || [] });
  }
  if (path === "/api/services" && method === "GET") {
    const result = await db.prepare("SELECT * FROM salon_services WHERE is_active = 1 ORDER BY name").all();
    return json({ services: (result.results || []).map(toService) });
  }
  if (path === "/api/settings" && method === "GET") return json({ settings: await publicSettings(db) });

  const availabilityMatch = path.match(/^\/api\/availability$/);
  if (availabilityMatch && method === "GET") {
    const serviceId = requiredText(url.searchParams.get("serviceId"), "Service", 80);
    const service = await serviceById(db, serviceId);
    const date = validDate(url.searchParams.get("date"));
    const config = await salonConfig(db);
    return json({ date, timezone: config.timezone, times: await availableTimes(db, service, date) });
  }
  if (path === "/api/appointments" && method === "POST") {
    checkOrigin(request, env);
    return json({ appointment: await createAppointment(db, await readJson(request)) }, 201);
  }

  if (path === "/api/admin/auth/login" && method === "POST") return adminLogin(db, request, env);
  if (path === "/api/admin/auth/logout" && method === "POST") {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) await db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await digestToken(token)).run();
    return json({ ok: true }, 200, { "Set-Cookie": cookieHeader("", 0) });
  }
  if (path === "/api/admin/auth/session" && method === "GET") {
    const admin = await requireAdmin(request, env);
    return json({ admin });
  }

  const admin = await requireAdmin(request, env);
  if (path === "/api/admin/products" && method === "GET") {
    return json({ products: await listProducts(db, url) });
  }
  if (path === "/api/admin/products" && method === "POST") {
    checkOrigin(request, env);
    return json({ product: await saveProduct(db, await readJson(request)) }, 201);
  }
  const adminProductMatch = path.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (adminProductMatch) {
    const id = validId(decodeURIComponent(adminProductMatch[1]));
    if (method === "PUT") {
      checkOrigin(request, env);
      return json({ product: await saveProduct(db, await readJson(request), id) });
    }
    if (method === "DELETE") {
      checkOrigin(request, env);
      await deleteProduct(db, id);
      return json({ ok: true });
    }
  }
  if (path === "/api/admin/categories" && method === "GET") {
    const result = await db.prepare("SELECT * FROM categories ORDER BY category_type, name").all();
    return json({ categories: result.results || [] });
  }
  if (path === "/api/admin/categories" && method === "POST") {
    checkOrigin(request, env);
    const body = await readJson(request);
    const name = requiredText(body.name, "Category name", 100);
    const slug = slugify(name);
    if (!slug) throw new HttpError(400, "Category name must contain letters or numbers.");
    const type = body.type;
    if (type !== "collectibles" && type !== "beauty") throw new HttpError(400, "Choose a valid category type.");
    const duplicate = await db.prepare("SELECT id FROM categories WHERE category_type = ? AND slug = ?").bind(type, slug).first();
    if (duplicate) throw new HttpError(409, "A category with that name already exists in this business area.");
    const id = randomId();
    await db.prepare("INSERT INTO categories (id, name, slug, category_type) VALUES (?, ?, ?, ?)")
      .bind(id, name, slug, type).run();
    return json({ category: { id, name, slug, category_type: type } }, 201);
  }
  const categoryMatch = path.match(/^\/api\/admin\/categories\/([^/]+)$/);
  if (categoryMatch) {
    const id = validId(decodeURIComponent(categoryMatch[1]));
    if (method === "PUT") {
      checkOrigin(request, env);
      const body = await readJson(request);
      const name = requiredText(body.name, "Category name", 100);
      const slug = slugify(name);
      if (!slug) throw new HttpError(400, "Category name must contain letters or numbers.");
      const type = body.type;
      if (type !== "collectibles" && type !== "beauty") throw new HttpError(400, "Choose a valid category type.");
      const duplicate = await db.prepare("SELECT id FROM categories WHERE category_type = ? AND slug = ? AND id != ?").bind(type, slug, id).first();
      if (duplicate) throw new HttpError(409, "A category with that name already exists in this business area.");
      const result = await db.prepare("UPDATE categories SET name = ?, slug = ?, category_type = ?, updated_at = ? WHERE id = ?")
        .bind(name, slug, type, new Date().toISOString(), id).run();
      if (!result.meta?.changes) throw new HttpError(404, "Category not found.");
      return json({ ok: true });
    }
    if (method === "DELETE") {
      checkOrigin(request, env);
      const linkedProduct = await db.prepare("SELECT id FROM products WHERE category_id = ? LIMIT 1").bind(id).first();
      if (linkedProduct) throw new HttpError(409, "Move or delete this category's products before deleting it.");
      const result = await db.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
      if (!result.meta?.changes) throw new HttpError(404, "Category not found.");
      return json({ ok: true });
    }
  }
  if (path === "/api/admin/images" && method === "POST") {
    checkOrigin(request, env);
    throw new HttpError(410, "Image uploads are disabled. Use a static website image path.");
  }
  if (path === "/api/admin/services" && method === "GET") {
    const result = await db.prepare("SELECT * FROM salon_services ORDER BY name").all();
    return json({ services: (result.results || []).map(toService) });
  }
  if (path === "/api/admin/services" && method === "POST") {
    checkOrigin(request, env);
    const service = servicePayload(await readJson(request));
    const id = randomId();
    await db.prepare(`
      INSERT INTO salon_services (id, name, description, price_minor, duration_minutes, image_key, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, service.name, service.description, service.price, service.durationMinutes, service.imageKey, service.isActive).run();
    return json({ service: toService(await db.prepare("SELECT * FROM salon_services WHERE id = ?").bind(id).first()) }, 201);
  }
  const adminServiceMatch = path.match(/^\/api\/admin\/services\/([^/]+)$/);
  if (adminServiceMatch) {
    const id = validId(decodeURIComponent(adminServiceMatch[1]));
    if (method === "PUT") {
      checkOrigin(request, env);
      const service = servicePayload(await readJson(request));
      const previous = await db.prepare("SELECT id FROM salon_services WHERE id = ?").bind(id).first();
      if (!previous) throw new HttpError(404, "Salon service not found.");
      const result = await db.prepare(`
        UPDATE salon_services SET name = ?, description = ?, price_minor = ?, duration_minutes = ?,
          image_key = ?, is_active = ?, updated_at = ? WHERE id = ?
      `).bind(service.name, service.description, service.price, service.durationMinutes,
        service.imageKey, service.isActive, new Date().toISOString(), id).run();
      if (!result.meta?.changes) throw new HttpError(404, "Salon service not found.");
      return json({ service: toService(await db.prepare("SELECT * FROM salon_services WHERE id = ?").bind(id).first()) });
    }
    if (method === "DELETE") {
      checkOrigin(request, env);
      const service = await db.prepare("SELECT image_key FROM salon_services WHERE id = ?").bind(id).first();
      if (!service) throw new HttpError(404, "Salon service not found.");
      const result = await db.prepare("DELETE FROM salon_services WHERE id = ?").bind(id).run();
      if (!result.meta?.changes) throw new HttpError(404, "Salon service not found.");
      return json({ ok: true });
    }
  }
  if (path === "/api/admin/salon-settings" && method === "GET") {
    return json({ settings: await salonConfig(db) });
  }
  if (path === "/api/admin/salon-settings" && method === "PUT") {
    checkOrigin(request, env);
    const body = await readJson(request);
    const openingHours = validateHours(body.openingHours);
    const timezone = requiredText(body.timezone || DEFAULT_TIMEZONE, "Timezone", 64);
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      throw new HttpError(400, "Choose a valid timezone.");
    }
    const interval = Number(body.slotIntervalMinutes);
    if (!Number.isInteger(interval) || interval < 5 || interval > 180) throw new HttpError(400, "Slot interval must be between 5 and 180 minutes.");
    await db.prepare("UPDATE salon_settings SET timezone = ?, opening_hours_json = ?, slot_interval_minutes = ?, updated_at = ? WHERE id = 1")
      .bind(timezone, JSON.stringify(openingHours), interval, new Date().toISOString()).run();
    return json({ settings: await salonConfig(db) });
  }
  if (path === "/api/admin/settings" && method === "GET") return json({ settings: await publicSettings(db) });
  if (path === "/api/admin/settings" && method === "PUT") {
    checkOrigin(request, env);
    const body = await readJson(request);
    const fields = {
      contact_phone: validPhone(body.phone),
      contact_email: validEmail(body.email),
      whatsapp_number: optionalText(body.whatsapp, "WhatsApp number", 32),
      business_address: optionalText(body.address, "Business address", 500)
    };
    if (fields.whatsapp_number && !/^\+?[0-9 ()-]{6,31}$/.test(fields.whatsapp_number)) throw new HttpError(400, "Enter a valid WhatsApp number.");
    const statements = Object.entries(fields).map(([key, value]) => db.prepare(`
        INSERT INTO site_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at
      `).bind(key, value, new Date().toISOString()));
    await db.batch(statements);
    return json({ settings: await publicSettings(db) });
  }
  if (path === "/api/admin/appointments" && method === "GET") {
    return json({ appointments: await adminAppointments(db, url) });
  }
  const adminAppointmentMatch = path.match(/^\/api\/admin\/appointments\/([^/]+)$/);
  if (adminAppointmentMatch && method === "PUT") {
    checkOrigin(request, env);
    const id = validId(decodeURIComponent(adminAppointmentMatch[1]));
    return json({ appointment: await updateAppointment(db, id, await readJson(request)) });
  }
  if (path.startsWith("/api/admin/")) {
    throw new HttpError(404, "Admin endpoint not found.");
  }
  return null;
}

function mediaResponse() {
  return json({ error: "R2-backed media is unavailable. Use a static website image path." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      if (request.headers.get("Origin") && !cors["Access-Control-Allow-Origin"]) {
        return json({ error: "This origin is not allowed." }, 403);
      }
      const requestedMethod = request.headers.get("Access-Control-Request-Method")?.toUpperCase();
      if (requestedMethod && !CORS_METHODS.includes(requestedMethod)) {
        return json({ error: "This request method is not allowed." }, 405, cors);
      }
      const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") || "")
        .split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
      if (requestedHeaders.some(header => !CORS_HEADERS.includes(header))) {
        return json({ error: "A request header is not allowed." }, 400, cors);
      }
      return new Response(null, { status: 204, headers: cors });
    }
    if (!url.pathname.startsWith("/api/")) return new Response("Not found.", { status: 404 });
    if (url.pathname.startsWith("/api/admin/") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      try {
        checkOrigin(request, env);
      } catch (error) {
        return json({ error: error.message }, error.status || 403, cors);
      }
    }
    try {
      if ((url.pathname.startsWith("/api/media/")) && (request.method === "GET" || request.method === "HEAD")) {
        return mediaResponse();
      }
      const response = await handleApi(request, env, url);
      if (!response) return json({ error: "Endpoint not found." }, 404, cors);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(cors)) headers.set(key, value);
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) console.error("API request failed", { path: url.pathname, message: error?.message });
      return json({ error: status === 500 ? "The request could not be completed." : error.message }, status, cors);
    }
  }
};
