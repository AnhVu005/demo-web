import { BLOG_GROUPS, PROJECTS, SERVICES, SEO, WEBSITE_INDUSTRIES } from "./content.js";
import { PAGES, renderBlogCategoryPage, renderProjectPage, renderServicePage, renderWebsiteIndustryPage } from "./pages.js";

const loginPanel = document.getElementById("login-panel");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const settingsForm = document.getElementById("settings-form");
const pageForm = document.getElementById("page-form");
const pageRoute = document.getElementById("page-route");
const blocksContainer = document.getElementById("content-blocks");
const siteSelect = document.getElementById("site-select");
const newSiteForm = document.getElementById("new-site-form");
const customRouteForm = document.getElementById("custom-route-form");

let csrfToken = "";
let sites = [];
let activeSite = null;
let pagesByRoute = new Map();

const knownRoutes = new Map();
function addRoute(route, html) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const heading = parsed.querySelector("h1")?.textContent.trim() || route || "Trang chủ";
  knownRoutes.set(route, heading);
}

for (const [route, render] of Object.entries(PAGES)) {
  addRoute(route, render());
}
for (const service of SERVICES) {
  addRoute(`dich-vu/${service.slug}`, renderServicePage(service));
}
for (const industry of WEBSITE_INDUSTRIES) {
  addRoute(
    `dich-vu/thiet-ke-website/${industry.slug}`,
    renderWebsiteIndustryPage(industry)
  );
}
for (const project of PROJECTS) {
  addRoute(`du-an/${project.id}`, renderProjectPage(project));
}
for (const group of BLOG_GROUPS) {
  for (const category of group.categories) {
    addRoute(`blog/${category.slug}`, renderBlogCategoryPage(category));
  }
}
const standardRoutes = new Map(knownRoutes);

function setStatus(element, message, state = "") {
  element.textContent = message;
  if (state) {
    element.dataset.state = state;
  } else {
    delete element.dataset.state;
  }
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(options.method)) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin"
  });
  if (response.status === 204) {
    return null;
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(
      "Không kết nối được CMS API. Hãy khởi động backend và kiểm tra cấu hình API."
    );
  }
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      showLogin();
    }
    throw new Error(result.error || "Không thể hoàn thành yêu cầu.");
  }
  return result;
}

async function refreshCsrf() {
  const result = await request("/api/auth/csrf");
  csrfToken = result.csrfToken;
}

function showLogin() {
  loginPanel.hidden = false;
  dashboard.hidden = true;
}

function showDashboard(email) {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  document.getElementById("signed-in-as").textContent = email;
}

function pageMarkup(route) {
  if (PAGES[route]) {
    return PAGES[route]();
  }
  const [section, slug, industrySlug] = route.split("/");
  if (section === "dich-vu" && industrySlug) {
    const industry = WEBSITE_INDUSTRIES.find((item) => item.slug === industrySlug);
    return industry ? renderWebsiteIndustryPage(industry) : "";
  }
  if (section === "dich-vu") {
    const service = SERVICES.find((item) => item.slug === slug);
    return service ? renderServicePage(service) : "";
  }
  if (section === "du-an") {
    const project = PROJECTS.find((item) => item.id === slug);
    return project ? renderProjectPage(project) : "";
  }
  if (section === "blog") {
    const category = BLOG_GROUPS.flatMap((group) => group.categories).find(
      (item) => item.slug === slug
    );
    return category ? renderBlogCategoryPage(category) : "";
  }
  return "";
}

function updatePageForm(route) {
  const saved = pagesByRoute.get(route);
  const pageFormData = new FormData(pageForm);
  const parsed = new DOMParser().parseFromString(pageMarkup(route), "text/html");
  const title = saved?.title || parsed.querySelector("main h1,h1")?.textContent.trim() || knownRoutes.get(route) || "";
  const intro = saved?.intro || parsed.querySelector(".ban p")?.textContent.trim() || "";
  pageFormData.set("route", route);
  pageFormData.set("routeDisplay", route ? `?page=${route}` : "?page=");
  pageFormData.set("title", title);
  pageFormData.set("intro", intro);
  pageFormData.set("seoTitle", saved?.seo_title || SEO.pages[route]?.title || "");
  pageFormData.set(
    "seoDescription",
    saved?.seo_description || SEO.pages[route]?.description || ""
  );
  pageFormData.set(
    "focusKeywords",
    (saved?.focus_keywords || []).join(", ")
  );
  pageFormData.set("isPublished", saved?.is_published ? "on" : "");
  for (const [name, value] of pageFormData) {
    const input = pageForm.elements.namedItem(name);
    if (!input || name === "isPublished") {
      continue;
    }
    input.value = String(value);
  }
  pageForm.elements.namedItem("isPublished").checked =
    Boolean(saved?.is_published);
  renderBlocks(saved?.content_blocks || []);
}

function renderBlocks(blocks) {
  blocksContainer.replaceChildren();
  blocks.forEach((block) => blocksContainer.append(createBlock(block)));
}

function createBlock(block = { type: "paragraph", text: "" }) {
  const item = document.createElement("article");
  item.className = "content-block";

  const typeLabel = document.createElement("label");
  typeLabel.append("Loại nội dung");
  const type = document.createElement("select");
  type.setAttribute("aria-label", "Loại khối nội dung");
  for (const [value, label] of [
    ["h2", "Tiêu đề H2"],
    ["h3", "Tiêu đề H3"],
    ["paragraph", "Đoạn văn"],
    ["image", "Hình ảnh"]
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    type.append(option);
  }
  type.value = block.type;
  typeLabel.append(type);

  const fields = document.createElement("div");
  fields.className = "block-fields";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "button secondary";
  remove.textContent = "Xóa";
  remove.addEventListener("click", () => item.remove());
  type.addEventListener("change", () => updateBlockFields(item, type.value, {}));
  item.append(typeLabel, fields, remove);
  updateBlockFields(item, block.type, block);
  return item;
}

function makeLabeledInput(labelText, value, multiline = false) {
  const label = document.createElement("label");
  label.append(labelText);
  const input = document.createElement(multiline ? "textarea" : "input");
  input.value = value || "";
  if (multiline) {
    input.rows = 4;
  }
  label.append(input);
  return { label, input };
}

function updateBlockFields(item, type, block) {
  const fields = item.querySelector(".block-fields");
  fields.replaceChildren();
  if (type === "image") {
    fields.classList.add("block-image-fields");
    const url = makeLabeledInput("Đường dẫn ảnh", block.src || "");
    url.input.dataset.field = "src";
    const alt = makeLabeledInput("Mô tả ảnh (alt)", block.alt || "");
    alt.input.dataset.field = "alt";
    const upload = document.createElement("input");
    upload.type = "file";
    upload.accept = "image/png,image/jpeg,image/webp,image/avif,image/gif";
    upload.setAttribute("aria-label", "Tải ảnh nội dung lên");
    upload.addEventListener("change", () => uploadImage(upload, url.input));
    fields.append(url.label, alt.label, upload);
  } else {
    fields.classList.remove("block-image-fields");
    const text = makeLabeledInput(
      type === "paragraph" ? "Nội dung đoạn văn" : "Nội dung tiêu đề",
      block.text || "",
      type === "paragraph"
    );
    text.input.dataset.field = "text";
    text.input.maxLength = type === "paragraph" ? 4000 : 200;
    fields.append(text.label);
  }
}

function readBlocks() {
  return [...blocksContainer.querySelectorAll(".content-block")].map((item) => {
    const type = item.querySelector("select").value;
    if (type === "image") {
      return {
        type,
        src: item.querySelector('[data-field="src"]').value.trim(),
        alt: item.querySelector('[data-field="alt"]').value.trim()
      };
    }
    return {
      type,
      text: item.querySelector('[data-field="text"]').value.trim()
    };
  });
}

function fillSettings(site) {
  const values = {
    name: site.name,
    domain: site.domain || "",
    brandName: site.settings?.brandName || site.name,
    logoUrl: site.settings?.logoUrl || "",
    defaultSeoTitle: site.settings?.defaultSeoTitle || "",
    defaultSeoDescription: site.settings?.defaultSeoDescription || "",
    focusKeywords: (site.settings?.focusKeywords || []).join(", "),
    phone: site.settings?.phone || "",
    email: site.settings?.email || "",
    address: site.settings?.address || "",
    zaloUrl: site.settings?.zaloUrl || "",
    footerDescription: site.settings?.footerDescription || ""
  };
  for (const [key, value] of Object.entries(values)) {
    settingsForm.elements.namedItem(key).value = value;
  }
}

async function loadSite(siteId) {
  activeSite = sites.find((site) => site.id === siteId) || sites[0] || null;
  if (!activeSite) {
    return;
  }
  siteSelect.value = activeSite.id;
  fillSettings(activeSite);
  const result = await request(`/api/sites/${activeSite.id}/pages`);
  pagesByRoute = new Map(result.pages.map((page) => [page.route, page]));
  knownRoutes.clear();
  standardRoutes.forEach((title, route) => knownRoutes.set(route, title));
  populateRouteOptions();
  for (const page of result.pages) {
    if (!knownRoutes.has(page.route)) {
      addRouteOption(page.route, page.title || page.route.replaceAll("/", " / "));
    }
  }
  if (![...pageRoute.options].some((option) => option.value === pageRoute.value)) {
    pageRoute.value = pageRoute.options[0]?.value || "";
  }
  updatePageForm(pageRoute.value);
}

async function loadSites() {
  const result = await request("/api/sites");
  sites = result.sites;
  siteSelect.replaceChildren();
  for (const site of sites) {
    const option = document.createElement("option");
    option.value = site.id;
    option.textContent = site.name;
    siteSelect.append(option);
  }
  if (sites.length) {
    await loadSite(activeSite?.id);
  }
}

function populateRouteOptions() {
  pageRoute.replaceChildren();
  for (const [route, title] of knownRoutes) {
    const option = document.createElement("option");
    option.value = route;
    option.textContent = `${title} — ${route ? `?page=${route}` : "trang chủ"}`;
    pageRoute.append(option);
  }
}

function addRouteOption(route, title) {
  let option = [...pageRoute.options].find((item) => item.value === route);
  if (!option) {
    option = document.createElement("option");
    option.value = route;
    pageRoute.append(option);
  }
  option.textContent = `${title} — ?page=${route}`;
  knownRoutes.set(route, title);
  return option;
}

function formKeywords(value) {
  return value.split(",").map((keyword) => keyword.trim()).filter(Boolean);
}

async function uploadImage(fileInput, targetInput) {
  const file = fileInput.files?.[0];
  if (!file || !activeSite) {
    return;
  }
  const status = document.getElementById("page-status");
  const formData = new FormData();
  formData.append("image", file);
  try {
    const result = await request(`/api/sites/${activeSite.id}/media`, {
      method: "POST",
      body: formData
    });
    targetInput.value = result.url;
    setStatus(status, "Ảnh đã tải lên. Lưu trang để cập nhật nội dung.", "success");
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    fileInput.value = "";
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(loginStatus, "Đang đăng nhập…");
  const formData = new FormData(loginForm);
  try {
    const result = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password")
      })
    });
    csrfToken = result.csrfToken;
    showDashboard(result.user.email);
    try {
      await loadSites();
    } catch (error) {
      setStatus(document.getElementById("settings-status"), error.message, "error");
    }
  } catch (error) {
    setStatus(loginStatus, error.message, "error");
  }
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeSite) {
    return;
  }
  const status = document.getElementById("settings-status");
  const values = new FormData(settingsForm);
  try {
    const result = await request(`/api/sites/${activeSite.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: values.get("name"),
        domain: values.get("domain"),
        settings: {
          brandName: values.get("brandName"),
          logoUrl: values.get("logoUrl"),
          defaultSeoTitle: values.get("defaultSeoTitle"),
          defaultSeoDescription: values.get("defaultSeoDescription"),
          focusKeywords: formKeywords(values.get("focusKeywords")),
          phone: values.get("phone"),
          email: values.get("email"),
          address: values.get("address"),
          zaloUrl: values.get("zaloUrl"),
          footerDescription: values.get("footerDescription")
        }
      })
    });
    activeSite = result.site;
    sites = sites.map((site) => site.id === activeSite.id ? activeSite : site);
    siteSelect.selectedOptions[0].textContent = activeSite.name;
    setStatus(status, "Đã lưu thông tin website.", "success");
  } catch (error) {
    setStatus(status, error.message, "error");
  }
});

pageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeSite) {
    return;
  }
  const status = document.getElementById("page-status");
  const values = new FormData(pageForm);
  try {
    const result = await request(
      `/api/sites/${activeSite.id}/pages`,
      {
        method: "PUT",
        body: JSON.stringify({
          route: values.get("route"),
          title: values.get("title"),
          intro: values.get("intro"),
          seoTitle: values.get("seoTitle"),
          seoDescription: values.get("seoDescription"),
          focusKeywords: formKeywords(values.get("focusKeywords")),
          contentBlocks: readBlocks(),
          isPublished: values.get("isPublished") === "on"
        })
      }
    );
    pagesByRoute.set(result.page.route, result.page);
    addRouteOption(result.page.route, result.page.title || result.page.route);
    setStatus(status, "Đã lưu nội dung và SEO trang.", "success");
  } catch (error) {
    setStatus(status, error.message, "error");
  }
});

siteSelect.addEventListener("change", async () => {
  try {
    await loadSite(siteSelect.value);
  } catch (error) {
    setStatus(document.getElementById("settings-status"), error.message, "error");
  }
});

pageRoute.addEventListener("change", () => updatePageForm(pageRoute.value));
customRouteForm.querySelector("button").addEventListener("click", () => {
  const routeInput = document.getElementById("custom-route-path");
  const route = routeInput.value.trim().replace(/^\/+|\/+$/g, "");
  if (
    !route ||
    route.length > 180 ||
    !/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(route)
  ) {
    routeInput.setCustomValidity(
      "Chỉ dùng chữ thường không dấu, số, dấu gạch ngang hoặc dấu gạch chéo."
    );
    routeInput.reportValidity();
    return;
  }
  routeInput.setCustomValidity("");
  const option = addRouteOption(route, route.replaceAll("/", " / "));
  pageRoute.value = option.value;
  routeInput.value = "";
  updatePageForm(route);
  setStatus(
    document.getElementById("page-status"),
    "Đã thêm đường dẫn vào danh sách. Nhập nội dung rồi lưu trang để lưu lên máy chủ.",
    "success"
  );
});
document.getElementById("add-block").addEventListener("click", () => {
  blocksContainer.append(createBlock());
});

document.getElementById("logo-upload").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file || !activeSite) {
    return;
  }
  const formData = new FormData();
  formData.append("image", file);
  try {
    const result = await request(`/api/sites/${activeSite.id}/media`, {
      method: "POST",
      body: formData
    });
    settingsForm.elements.namedItem("logoUrl").value = result.url;
    setStatus(
      document.getElementById("settings-status"),
      "Logo đã tải lên. Lưu thông tin website để áp dụng.",
      "success"
    );
  } catch (error) {
    setStatus(document.getElementById("settings-status"), error.message, "error");
  } finally {
    input.value = "";
  }
});

newSiteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(newSiteForm);
  try {
    const result = await request("/api/sites", {
      method: "POST",
      body: JSON.stringify({
        name: values.get("name"),
        slug: values.get("slug"),
        domain: values.get("domain")
      })
    });
    sites.push(result.site);
    newSiteForm.reset();
    await loadSites();
    await loadSite(result.site.id);
  } catch (error) {
    setStatus(document.getElementById("settings-status"), error.message, "error");
  }
});

document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    await request("/api/auth/logout", { method: "POST" });
    csrfToken = "";
    showLogin();
    await refreshCsrf();
  } catch (error) {
    setStatus(loginStatus, error.message, "error");
  }
});

async function initialize() {
  populateRouteOptions();
  try {
    await refreshCsrf();
    const result = await request("/api/auth/me");
    showDashboard(result.user.email);
    try {
      await loadSites();
    } catch (error) {
      setStatus(document.getElementById("settings-status"), error.message, "error");
    }
  } catch (error) {
    showLogin();
    if (error.message !== "Vui lòng đăng nhập để tiếp tục.") {
      setStatus(loginStatus, error.message, "error");
    }
  }
}

initialize();
