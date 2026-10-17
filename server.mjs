import "dotenv/config";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import connectPgSimple from "connect-pg-simple";
import express from "express";
import { rateLimit } from "express-rate-limit";
import session from "express-session";
import helmet from "helmet";
import multer from "multer";
import pg from "pg";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const publicBaseUrl = new URL(
  process.env.PUBLIC_BASE_URL || `http://localhost:${port}`
).origin;
const uploadDirectory = path.resolve(
  root,
  process.env.UPLOAD_DIRECTORY || "uploads"
);
const maxImageSizeMb = Number(process.env.MAX_IMAGE_SIZE_MB || 5);
const maxImageSize = maxImageSizeMb * 1024 * 1024;
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET || "";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}
if (
  sessionSecret.length < 32 ||
  sessionSecret === "replace-with-at-least-32-random-characters"
) {
  throw new Error("SESSION_SECRET must contain at least 32 characters.");
}
if (isProduction && new URL(publicBaseUrl).protocol !== "https:") {
  throw new Error("PUBLIC_BASE_URL must use HTTPS in production.");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}
if (!Number.isInteger(maxImageSizeMb) || maxImageSizeMb < 1 || maxImageSizeMb > 20) {
  throw new Error("MAX_IMAGE_SIZE_MB must be an integer between 1 and 20.");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const PgSession = connectPgSimple(session);
const app = express();

if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "https:", "data:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"]
      }
    }
  })
);
app.use(express.json({ limit: "1mb", strict: true }));
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});
app.use(
  session({
    name: "ocean_cms_session",
    store: new PgSession({
      pool,
      tableName: "cms_sessions",
      createTableIfMissing: true
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      maxAge: 8 * 60 * 60 * 1000,
      sameSite: "strict",
      secure: isProduction
    }
  })
);

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function requireCsrf(req, res, next) {
  const token = req.get("x-csrf-token");
  if (
    !req.session.csrfToken ||
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/.test(token) ||
    token.length !== req.session.csrfToken.length ||
    !timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrfToken))
  ) {
    return sendError(res, 403, "Phiên bảo mật hết hạn. Hãy tải lại trang.");
  }
  return next();
}

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return sendError(res, 401, "Vui lòng đăng nhập để tiếp tục.");
  }
  return next();
}

async function requireSiteAccess(req, res, siteId) {
  const result = await pool.query(
    `SELECT m.role
       FROM cms_site_members AS m
       JOIN cms_sites AS s ON s.id = m.site_id
      WHERE m.user_id = $1 AND m.site_id = $2`,
    [req.session.userId, siteId]
  );
  if (!result.rowCount) {
    sendError(res, 404, "Không tìm thấy website hoặc bạn không có quyền.");
    return false;
  }
  if (result.rows[0].role !== "owner" && req.method !== "GET") {
    sendError(res, 403, "Tài khoản này chỉ được xem nội dung.");
    return false;
  }
  return true;
}

function validSlug(value) {
  return (
    typeof value === "string" &&
    value.length <= 80 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

function validRoute(value) {
  return (
    typeof value === "string" &&
    value.length <= 180 &&
    (value === "" ||
      /^[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(value))
  );
}

function boundedText(value, maximum, field) {
  if (typeof value !== "string" || value.length > maximum) {
    throw new Error(`${field} không hợp lệ hoặc vượt quá giới hạn ký tự.`);
  }
  return value.trim();
}

function safeAssetUrl(value, siteId) {
  if (typeof value !== "string" || value.length > 2048) {
    return false;
  }
  try {
    const url = new URL(value, publicBaseUrl);
    if (url.protocol === "https:") {
      return true;
    }
    return (
      url.origin === publicBaseUrl &&
      url.pathname.startsWith(`/uploads/${siteId}/`)
    );
  } catch {
    return false;
  }
}

function normalizeBlocks(value, siteId) {
  if (!Array.isArray(value) || value.length > 80) {
    throw new Error("Nội dung trang phải là danh sách tối đa 80 khối.");
  }
  return value.map((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      throw new Error("Có khối nội dung không hợp lệ.");
    }
    if (block.type === "h2" || block.type === "h3") {
      return {
        type: block.type,
        text: boundedText(block.text, 200, "Tiêu đề")
      };
    }
    if (block.type === "paragraph") {
      return {
        type: "paragraph",
        text: boundedText(block.text, 4000, "Đoạn văn")
      };
    }
    if (block.type === "image") {
      const src = boundedText(block.src, 2048, "Đường dẫn hình ảnh");
      if (!safeAssetUrl(src, siteId)) {
        throw new Error("Hình ảnh phải dùng HTTPS hoặc ảnh đã tải lên website này.");
      }
      return {
        type: "image",
        src,
        alt: boundedText(block.alt || "", 250, "Mô tả hình ảnh")
      };
    }
    throw new Error("Loại khối nội dung không được hỗ trợ.");
  });
}

function normalizeKeywords(value) {
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("Tối đa 20 từ khóa SEO cho mỗi trang.");
  }
  return value.map((keyword) => boundedText(keyword, 80, "Từ khóa"));
}

async function setCorsForPublicSite(req, res, next) {
  const origin = req.get("origin");
  if (!origin) {
    return next();
  }
  let originHost;
  try {
    const parsedOrigin = new URL(origin);
    if (isProduction && parsedOrigin.protocol !== "https:") {
      return sendError(res, 403, "Website cần kết nối CMS qua HTTPS.");
    }
    originHost = parsedOrigin.hostname.toLowerCase();
  } catch {
    return sendError(res, 403, "Nguồn truy cập không hợp lệ.");
  }
  const result = await pool.query(
    "SELECT domain FROM cms_sites WHERE slug = $1",
    [req.params.slug]
  );
  const allowedHost = result.rows[0]?.domain
    ?.replace(/^https?:\/\//, "")
    .split("/")[0]
    .toLowerCase();
  const localHosts = new Set([
    new URL(publicBaseUrl).hostname.toLowerCase(),
    "localhost",
    "127.0.0.1"
  ]);
  if (!allowedHost || (originHost !== allowedHost && !localHosts.has(originHost))) {
    return sendError(res, 403, "Website này chưa được phép đọc dữ liệu.");
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  return next();
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Quá nhiều lần đăng nhập. Hãy thử lại sau 15 phút." }
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxImageSize, files: 1 },
  fileFilter(req, file, callback) {
    const allowed = new Set([
      "image/avif",
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp"
    ]);
    if (!allowed.has(file.mimetype)) {
    const error = new Error("Chỉ chấp nhận hình PNG, JPG, WebP, AVIF hoặc GIF.");
    error.status = 400;
    callback(error);
      return;
    }
    callback(null, true);
  }
});

function detectImage(buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { extension: "png", mime: "image/png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: "jpg", mime: "image/jpeg" };
  }
  if (buffer.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/)) {
    return { extension: "gif", mime: "image/gif" };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { extension: "webp", mime: "image/webp" };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(4, 8).toString("ascii") === "ftyp" &&
    /^(avif|avis)$/.test(buffer.subarray(8, 12).toString("ascii"))
  ) {
    return { extension: "avif", mime: "image/avif" };
  }
  return null;
}

app.get("/api/auth/csrf", (req, res) => {
  req.session.csrfToken ||= randomBytes(32).toString("hex");
  res.json({ csrfToken: req.session.csrfToken });
});

app.post("/api/auth/login", loginLimiter, requireCsrf, async (req, res) => {
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  if (email.length > 254 || password.length > 128) {
    return sendError(res, 400, "Email hoặc mật khẩu không hợp lệ.");
  }
  const result = await pool.query(
    "SELECT id, email, password_hash FROM cms_users WHERE email = $1",
    [email]
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return sendError(res, 401, "Email hoặc mật khẩu không chính xác.");
  }
  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
  req.session.userId = user.id;
  req.session.userEmail = user.email;
  req.session.csrfToken = randomBytes(32).toString("hex");
  return res.json({ user: { email: user.email }, csrfToken: req.session.csrfToken });
});

app.get("/api/auth/me", requireLogin, (req, res) => {
  res.json({ user: { email: req.session.userEmail || "" } });
});

app.post("/api/auth/logout", requireLogin, requireCsrf, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }
    res.clearCookie("ocean_cms_session", {
      httpOnly: true,
      sameSite: "strict",
      secure: isProduction
    });
    res.status(204).end();
  });
});

app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/public/sites/")) {
    return next();
  }
  return requireLogin(req, res, next);
});

app.get("/api/sites", async (req, res) => {
  const result = await pool.query(
    `SELECT s.id, s.slug, s.name, s.domain, s.settings, s.updated_at, m.role
       FROM cms_sites AS s
       JOIN cms_site_members AS m ON m.site_id = s.id
      WHERE m.user_id = $1
      ORDER BY s.name`,
    [req.session.userId]
  );
  res.json({ sites: result.rows });
});

app.post("/api/sites", requireCsrf, async (req, res) => {
  const slug =
    typeof req.body?.slug === "string" ? req.body.slug.trim().toLowerCase() : "";
  const name =
    typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const domain =
    typeof req.body?.domain === "string" && req.body.domain.trim()
      ? req.body.domain.trim().toLowerCase()
      : null;
  if (!validSlug(slug) || !name || name.length > 100) {
    return sendError(res, 400, "Tên website hoặc mã website không hợp lệ.");
  }
  if (domain && !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)) {
    return sendError(res, 400, "Tên miền cần nhập dạng example.com.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const siteResult = await client.query(
      `INSERT INTO cms_sites (owner_user_id, slug, name, domain)
       VALUES ($1, $2, $3, $4)
       RETURNING id, slug, name, domain, settings, updated_at`,
      [req.session.userId, slug, name, domain]
    );
    const site = siteResult.rows[0];
    await client.query(
      "INSERT INTO cms_site_members (site_id, user_id, role) VALUES ($1, $2, 'owner')",
      [site.id, req.session.userId]
    );
    await client.query("COMMIT");
    res.status(201).json({ site });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return sendError(res, 409, "Mã website này đã được sử dụng.");
    }
    throw error;
  } finally {
    client.release();
  }
});

app.put("/api/sites/:siteId", requireCsrf, async (req, res) => {
  if (!(await requireSiteAccess(req, res, req.params.siteId))) {
    return;
  }
  const name =
    typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const domain =
    typeof req.body?.domain === "string" && req.body.domain.trim()
      ? req.body.domain.trim().toLowerCase()
      : null;
  const settings = req.body?.settings;
  if (!name || name.length > 100 || (domain && !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain))) {
    return sendError(res, 400, "Tên website hoặc tên miền không hợp lệ.");
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return sendError(res, 400, "Cấu hình website không hợp lệ.");
  }
  let normalizedSettings;
  try {
    normalizedSettings = {
      brandName: boundedText(settings.brandName || name, 100, "Tên thương hiệu"),
      logoUrl: boundedText(settings.logoUrl || "", 2048, "Logo"),
      defaultSeoTitle: boundedText(
        settings.defaultSeoTitle || "",
        160,
        "Tiêu đề SEO mặc định"
      ),
      defaultSeoDescription: boundedText(
        settings.defaultSeoDescription || "",
        320,
        "Mô tả SEO mặc định"
      ),
      focusKeywords: normalizeKeywords(settings.focusKeywords || []),
      phone: boundedText(settings.phone || "", 40, "Điện thoại"),
      email: boundedText(settings.email || "", 254, "Email"),
      address: boundedText(settings.address || "", 250, "Địa chỉ"),
      zaloUrl: boundedText(settings.zaloUrl || "", 2048, "Liên kết Zalo"),
      footerDescription: boundedText(
        settings.footerDescription || "",
        500,
        "Mô tả chân trang"
      )
    };
  } catch (error) {
    return sendError(res, 400, error.message);
  }
  if (
    normalizedSettings.logoUrl &&
    !safeAssetUrl(normalizedSettings.logoUrl, req.params.siteId)
  ) {
    return sendError(res, 400, "Logo phải dùng HTTPS hoặc ảnh đã tải lên website này.");
  }
  if (normalizedSettings.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedSettings.email)) {
    return sendError(res, 400, "Email liên hệ không hợp lệ.");
  }
  if (normalizedSettings.phone && !/^[0-9()+.\-\s]+$/.test(normalizedSettings.phone)) {
    return sendError(res, 400, "Số điện thoại chỉ được chứa chữ số và ký tự + ( ) . -.");
  }
  if (normalizedSettings.zaloUrl) {
    let zaloUrl;
    try {
      zaloUrl = new URL(normalizedSettings.zaloUrl);
    } catch {
      return sendError(res, 400, "Liên kết Zalo không hợp lệ.");
    }
    if (zaloUrl.protocol !== "https:") {
      return sendError(res, 400, "Liên kết Zalo cần sử dụng HTTPS.");
    }
  }
  const result = await pool.query(
    `UPDATE cms_sites
        SET name = $1, domain = $2, settings = $3::jsonb, updated_at = now()
      WHERE id = $4
      RETURNING id, slug, name, domain, settings, updated_at`,
    [name, domain, JSON.stringify(normalizedSettings), req.params.siteId]
  );
  res.json({ site: result.rows[0] });
});

app.get("/api/sites/:siteId/pages", async (req, res) => {
  if (!(await requireSiteAccess(req, res, req.params.siteId))) {
    return;
  }
  const result = await pool.query(
    `SELECT route, title, intro, seo_title, seo_description, focus_keywords,
            content_blocks, is_published, updated_at
       FROM cms_pages
      WHERE site_id = $1
      ORDER BY route`,
    [req.params.siteId]
  );
  res.json({ pages: result.rows });
});

app.put("/api/sites/:siteId/pages", requireCsrf, async (req, res) => {
  if (!(await requireSiteAccess(req, res, req.params.siteId))) {
    return;
  }
  const route = req.body?.route;
  if (!validRoute(route)) {
    return sendError(res, 400, "Đường dẫn trang không hợp lệ.");
  }
  let page;
  try {
    page = {
      title: boundedText(req.body?.title || "", 160, "Tiêu đề trang"),
      intro: boundedText(req.body?.intro || "", 500, "Mô tả trang"),
      seoTitle: boundedText(req.body?.seoTitle || "", 160, "Tiêu đề SEO"),
      seoDescription: boundedText(
        req.body?.seoDescription || "",
        320,
        "Mô tả SEO"
      ),
      focusKeywords: normalizeKeywords(req.body?.focusKeywords || []),
      contentBlocks: normalizeBlocks(
        req.body?.contentBlocks || [],
        req.params.siteId
      ),
      isPublished: req.body?.isPublished === true
    };
    if (page.isPublished && !page.title) {
      throw new Error("Trang đã bật nội dung quản trị cần có tiêu đề H1.");
    }
  } catch (error) {
    return sendError(res, 400, error.message);
  }
  const result = await pool.query(
    `INSERT INTO cms_pages
       (site_id, route, title, intro, seo_title, seo_description,
        focus_keywords, content_blocks, is_published, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now())
     ON CONFLICT (site_id, route) DO UPDATE
       SET title = EXCLUDED.title,
           intro = EXCLUDED.intro,
           seo_title = EXCLUDED.seo_title,
           seo_description = EXCLUDED.seo_description,
           focus_keywords = EXCLUDED.focus_keywords,
           content_blocks = EXCLUDED.content_blocks,
           is_published = EXCLUDED.is_published,
           updated_at = now()
     RETURNING route, title, intro, seo_title, seo_description, focus_keywords,
               content_blocks, is_published, updated_at`,
    [
      req.params.siteId,
      route,
      page.title,
      page.intro,
      page.seoTitle,
      page.seoDescription,
      page.focusKeywords,
      JSON.stringify(page.contentBlocks),
      page.isPublished
    ]
  );
  res.json({ page: result.rows[0] });
});

app.post(
  "/api/sites/:siteId/media",
  requireCsrf,
  async (req, res, next) => {
    if (!(await requireSiteAccess(req, res, req.params.siteId))) {
      return;
    }
    next();
  },
  imageUpload.single("image"),
  async (req, res) => {
    if (!req.file) {
      return sendError(res, 400, "Hãy chọn một hình ảnh để tải lên.");
    }
    const type = detectImage(req.file.buffer);
    if (!type || type.mime !== req.file.mimetype) {
      return sendError(res, 400, "Nội dung file không khớp định dạng hình ảnh.");
    }
    const siteDirectory = path.join(uploadDirectory, req.params.siteId);
    await mkdir(siteDirectory, { recursive: true });
    const fileName = `${randomUUID()}.${type.extension}`;
    await writeFile(path.join(siteDirectory, fileName), req.file.buffer, {
      flag: "wx",
      mode: 0o644
    });
    res.status(201).json({
      url: `${publicBaseUrl}/uploads/${req.params.siteId}/${fileName}`,
      mimeType: type.mime
    });
  }
);

app.get("/api/public/sites/:slug", setCorsForPublicSite, async (req, res) => {
  const siteResult = await pool.query(
    "SELECT id, slug, name, domain, settings FROM cms_sites WHERE slug = $1",
    [req.params.slug]
  );
  const site = siteResult.rows[0];
  if (!site) {
    return sendError(res, 404, "Không tìm thấy website.");
  }
  const pagesResult = await pool.query(
    `SELECT route, title, intro, seo_title, seo_description, focus_keywords,
            content_blocks
       FROM cms_pages
      WHERE site_id = $1 AND is_published = true`,
    [site.id]
  );
  const pages = Object.fromEntries(
    pagesResult.rows.map((page) => [
      page.route,
      {
        title: page.title,
        intro: page.intro,
        seoTitle: page.seo_title,
        seoDescription: page.seo_description,
        focusKeywords: page.focus_keywords,
        contentBlocks: page.content_blocks
      }
    ])
  );
  res.json({
    site: {
      slug: site.slug,
      name: site.name,
      settings: site.settings
    },
    pages
  });
});

app.use("/uploads", express.static(uploadDirectory, { immutable: true, maxAge: "1y" }));
app.use("/assets", express.static(path.join(root, "assets")));
app.use("/img", express.static(path.join(root, "img")));
app.get(["/", "/index.html"], (req, res) => {
  res.sendFile(path.join(root, "index.html"));
});
app.get(["/admin", "/admin.html"], (req, res) => {
  res.sendFile(path.join(root, "admin.html"));
});
app.use("/api", (req, res) => sendError(res, 404, "API không tồn tại."));
app.use((req, res) => {
  if (req.method === "GET" && req.accepts("html")) {
    res.sendFile(path.join(root, "index.html"));
    return;
  }
  res.status(404).type("text").send("Not found");
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof multer.MulterError) {
    sendError(
      res,
      400,
      error.code === "LIMIT_FILE_SIZE"
        ? `Ảnh vượt quá giới hạn ${Math.floor(maxImageSize / 1024 / 1024)} MB.`
        : "Không thể nhận file tải lên."
    );
    return;
  }
  if (error.status === 400) {
    sendError(res, 400, error.message);
    return;
  }
  console.error("CMS request failed:", error);
  sendError(res, 500, "Máy chủ gặp lỗi. Vui lòng thử lại sau.");
});

await pool.query("SELECT 1");
app.listen(port, () => {
  console.log(`Ocean Web CMS listening on ${publicBaseUrl}`);
});
