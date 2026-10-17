---
description: "Use when building or editing HTML, CSS, or JavaScript for web pages and interfaces. Covers responsive design, accessibility, browser behavior, and safe DOM updates."
name: "Web Development Standards"
applyTo:
  - "**/*.html"
  - "**/*.css"
  - "**/*.js"
---

# Web development standards

- Follow the project's existing stack and conventions; do not introduce a framework or dependency without a clear requirement.
- Use semantic HTML, meaningful labels, visible focus states, and keyboard-operable controls.
- Build mobile-first layouts and check narrow and wide viewports. Respect `prefers-reduced-motion`.
- Use CSS variables and existing design tokens when available; avoid duplicating styles or adding inline styles without a reason.
- Keep JavaScript behavior understandable and handle empty, invalid, or unavailable data explicitly.
- Avoid inserting untrusted values with `innerHTML`; prefer DOM APIs or `textContent`, and validate data at the boundary.
- Verify the affected page in a browser when possible and describe any checks that could not be performed.
