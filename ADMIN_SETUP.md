# CMS setup

The CMS is an optional Node.js and PostgreSQL service. The existing static site
continues to work without it. The administration interface is served at
`/admin`; the public website uses the CMS only when `cms-site` is configured.

## Requirements

- Node.js 20 or newer
- PostgreSQL 13 or newer and a database for this project
- A persistent writable directory for uploaded media in production

## Local setup on Windows

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to the PostgreSQL connection string. Set
   `SESSION_SECRET` to a unique random string of at least 32 characters. A
   value can be generated with
   `node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"`.
3. Run `npm install`, then `npm run db:setup`.
4. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SITE_SLUG`, `SITE_NAME`, and optionally
   `SITE_DOMAIN` in `.env`. The initial password must be at least 14 characters.
5. Run `npm run admin:create` once to create the first administrator and site.
   This command never prints or stores the plain-text password.
6. Run `npm run start`, then open `http://localhost:3000/admin`.

Do not commit `.env`, uploaded media, database backups, or real credentials.
Use HTTPS and a private, randomly generated session secret outside local
development.

## Reuse for client websites

Create one site entry for each client in the admin panel. Set its exact domain
without a protocol, for example `www.example.com`, so the API can allow public
content requests from that website. Set `PUBLIC_BASE_URL` to the public HTTPS
origin of the CMS so uploaded images receive usable absolute URLs.

On the client's existing `index.html`, configure the CMS site slug and API
origin:

```html
<meta name="cms-site" content="client-site-slug">
<meta name="cms-api" content="https://cms.example.com">
```

The client site must permit connections and images from the CMS origin in its
own Content Security Policy, if it has one. Configure PostgreSQL backups and a
persistent media volume; the database stores image references, while the image
files are stored under `uploads/`.

For client-specific routes, select the site in the admin, add the route in
"Thêm đường dẫn trang khách" (for example `gioi-thieu` or
`dich-vu/seo`), enter the content, and enable the CMS content toggle before
saving. The client website's router must pass the matching `?page=...` route to
the CMS page renderer. Routes managed through the admin replace the page's main
content area; shared navigation and footer remain part of the client website.

## Editing behavior

The global settings control the displayed brand name, logo, default SEO fields,
and domain. Saving a route with “Dùng nội dung quản trị cho trang này” enabled
replaces that route's main content with its H1, introduction, and content
blocks. The site's shared navigation, header structure, footer, and styles are
not editable through this panel. Text is stored as plain text and safely
rendered; uploaded images are checked by file signature and size.
