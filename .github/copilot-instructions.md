# Ocean Web project instructions

- Keep the project as plain HTML, CSS, and JavaScript. Do not add a framework, build system, dependencies, or generated files unless requested.
- `index.html` contains the shared document shell and SEO defaults. Keep page-specific SEO titles and descriptions in `SEO.pages` in `assets/js/content.js`.
- Edit business details, focus keywords, services, project examples, pricing, testimonials, team members, and process steps in `assets/js/content.js`.
- Edit route templates in `assets/js/pages.js`, shared navigation and page metadata in `assets/js/app.js`, domain/hosting lookups in `assets/js/domain-tools.js`, and visual styles in `assets/css/site.css`.
- Keep page links crawlable as `?page=...` query URLs. Preserve compatibility with existing `#/...` links when changing navigation.
- Set `SEO.siteUrl` to the real HTTPS production origin before publishing so the site emits absolute canonical URLs and production JSON-LD references.
- Write accurate, useful page copy around relevant search phrases; do not stuff keywords or publish unverified business details, statistics, reviews, or project results.
- Check mobile layouts, semantic HTML, keyboard focus, reduced-motion behavior, and browser console/network errors when changing the UI.
- Live Server uses port 5501. There is no configured build or automated test command; validate changes in the browser and report what was checked.
