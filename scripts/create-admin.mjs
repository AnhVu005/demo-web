import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const siteSlug = (process.env.SITE_SLUG || "ocean-web").trim().toLowerCase();
const siteName = (process.env.SITE_NAME || "Ocean Web").trim();
const siteDomain = process.env.SITE_DOMAIN?.trim().toLowerCase() || null;

if (!process.env.DATABASE_URL || !email || !password) {
  throw new Error(
    "Set DATABASE_URL, ADMIN_EMAIL, and ADMIN_PASSWORD in the environment."
  );
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("ADMIN_EMAIL must be a valid email address.");
}
if (
  password.length < 14 ||
  password.length > 128 ||
  password.startsWith("replace-with-")
) {
  throw new Error("ADMIN_PASSWORD must be between 14 and 128 characters.");
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(siteSlug) || siteName.length > 100) {
  throw new Error("SITE_SLUG or SITE_NAME is invalid.");
}
if (siteDomain && !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(siteDomain)) {
  throw new Error("SITE_DOMAIN must be a hostname such as www.example.com.");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  const passwordHash = await bcrypt.hash(password, 12);
  const userResult = await client.query(
    "INSERT INTO cms_users (email, password_hash) VALUES ($1, $2) RETURNING id",
    [email, passwordHash]
  );
  const siteResult = await client.query(
    `INSERT INTO cms_sites (owner_user_id, slug, name, domain)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userResult.rows[0].id, siteSlug, siteName, siteDomain]
  );
  await client.query(
    "INSERT INTO cms_site_members (site_id, user_id, role) VALUES ($1, $2, 'owner')",
    [siteResult.rows[0].id, userResult.rows[0].id]
  );
  await client.query("COMMIT");
  console.log(`Admin ${email} and website "${siteName}" created.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
