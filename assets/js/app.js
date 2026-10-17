import {
  CONTACT,
  BLOG_GROUPS,
  PROJECTS,
  SEO,
  SERVICES,
  WEBSITE_INDUSTRIES
} from "./content.js";
import {
  PAGES,
  renderProjectCard,
  renderProjectPage,
  renderBlogCategoryPage,
  renderServicePage,
  renderWebsiteIndustryPage
} from "./pages.js";
import { initDomainTools } from "./domain-tools.js";

const app = document.getElementById("app");
const header = document.querySelector("header");
const nav = document.getElementById("nv");
const menuButton = document.querySelector(".bg");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let productionOrigin = SEO.siteUrl ? new URL(SEO.siteUrl).origin : "";
const cmsSiteSlug = document.querySelector('meta[name="cms-site"]')?.content.trim();
const cmsApiBase = document
  .querySelector('meta[name="cms-api"]')
  ?.content.trim()
  .replace(/\/$/, "");
let cmsData = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}

function renderCmsPage(page) {
  const title = escapeHtml(page.title);
  const intro = escapeHtml(page.intro);
  const blocks = page.contentBlocks
    .map((block) => {
      if (block.type === "h2" || block.type === "h3") {
        return `<${block.type}>${escapeHtml(block.text)}</${block.type}>`;
      }
      if (block.type === "paragraph") {
        return `<p>${escapeHtml(block.text)}</p>`;
      }
      if (block.type === "image") {
        return `<figure><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" loading="lazy" decoding="async"></figure>`;
      }
      return "";
    })
    .join("");
  const breadcrumb = page.route
    ? ` / <span aria-current="page">${title}</span>`
    : "";
  return `<section class="ban"><div class="w"><nav class="cr" aria-label="Breadcrumb"><a href="?page=">Trang chủ</a>${breadcrumb}</nav><h1>${title}</h1><p>${intro}</p></div></section><section><div class="w cms-content">${blocks}</div></section>`;
}

async function loadCmsData() {
  if (!cmsSiteSlug || !cmsApiBase) {
    return;
  }
  try {
    const response = await fetch(
      `${cmsApiBase}/api/public/sites/${encodeURIComponent(cmsSiteSlug)}`,
      { headers: { Accept: "application/json" } }
    );
    if (!response.ok) {
      throw new Error(`CMS API returned HTTP ${response.status}.`);
    }
    cmsData = await response.json();
    if (cmsData.site?.domain) {
      productionOrigin = `https://${cmsData.site.domain
        .replace(/^https?:\/\//, "")
        .split("/")[0]}`;
    }
    const settings = cmsData.site?.settings || {};
    const brandName = settings.brandName || cmsData.site?.name;
    const logo = document.querySelector(".logo-mark img");
    if (logo && settings.logoUrl) {
      logo.src = settings.logoUrl;
      logo.alt = brandName || "";
    }
    const brand = document.querySelector(".logo > span:last-child");
    if (brand && brandName) {
      brand.textContent = brandName;
    }
    if (brandName) {
      document.querySelector(".logo")?.setAttribute("aria-label", brandName);
      const footerBrand = document.querySelector(".fg > div:first-child h2");
      if (footerBrand) {
        footerBrand.textContent = brandName;
      }
      const copyright = document.querySelector(".copy");
      if (copyright) {
        copyright.textContent = copyright.textContent.split("Ocean Web").join(brandName);
      }
      setMeta('meta[property="og:site_name"]', "content", brandName);
    }
    if (settings.footerDescription) {
      const footerDescription = document.querySelector(".fg > div:first-child p");
      if (footerDescription) {
        footerDescription.textContent = settings.footerDescription;
      }
    }
    const icon = document.querySelector('link[rel="icon"]');
    if (icon && settings.logoUrl) {
      icon.href = settings.logoUrl;
    }
  } catch (error) {
    console.error("Could not load website content from the CMS API.", error);
  }
}

function formatPhone(phone) {
  return phone.replace(/\s/g, "");
}

function initCopyProtection() {
  const isEditableTarget = (target) =>
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable="true"]');

  document.addEventListener(
    "copy",
    (event) => {
      if (!isEditableTarget(event.target)) {
        event.preventDefault();
      }
    },
    true
  );

  document.addEventListener(
    "contextmenu",
    (event) => {
      if (!isEditableTarget(event.target)) {
        event.preventDefault();
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "c" &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
      }
    },
    true
  );
}

function getRoute() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("page")) {
    return (params.get("page") || "").replace(/^\/+|\/+$/g, "");
  }

  return window.location.hash.startsWith("#/")
    ? window.location.hash.slice(2)
    : "";
}

function getPage(route) {
  const cmsPage = cmsData?.pages?.[route];
  if (cmsPage) {
    return applyCmsPage(route, { html: "" });
  }

  const [section, slug, subSlug] = route.split("/");

  if (section === "dich-vu" && slug === "thiet-ke-website" && subSlug) {
    const industry = WEBSITE_INDUSTRIES.find((item) => item.slug === subSlug);
    const service = SERVICES.find((item) => item.slug === slug);
    return applyCmsPage(
      route,
      industry && service
        ? { html: renderWebsiteIndustryPage(industry), service, industry }
        : { html: renderNotFound(), notFound: true }
    );
  }

  if (section === "blog" && slug && !subSlug) {
    const category = BLOG_GROUPS.flatMap((group) => group.categories).find(
      (item) => item.slug === slug
    );
    return applyCmsPage(
      route,
      category
        ? { html: renderBlogCategoryPage(category), category }
        : { html: renderNotFound(), notFound: true }
    );
  }

  if (section === "dich-vu" && slug && !subSlug) {
    const service = SERVICES.find((item) => item.slug === slug);
    return applyCmsPage(
      route,
      service
        ? { html: renderServicePage(service), service }
        : { html: renderNotFound(), notFound: true }
    );
  }

  if (section === "du-an" && slug) {
    const project = PROJECTS.find((item) => item.id === slug);
    return applyCmsPage(
      route,
      project
        ? { html: renderProjectPage(project), project }
        : { html: renderNotFound(), notFound: true }
    );
  }

  if (!PAGES[route]) {
    const cmsPage = cmsData?.pages?.[route];
    if (cmsPage) {
      return applyCmsPage(route, { html: "" });
    }
    return { html: renderNotFound(), notFound: true };
  }

  return applyCmsPage(route, { html: PAGES[route]() });
}

function applyCmsPage(route, page) {
  const cmsPage = cmsData?.pages?.[route];
  if (cmsPage) {
    return {
      ...page,
      html: renderCmsPage({ ...cmsPage, route }),
      cmsPage
    };
  }
  return page;
}

function renderNotFound() {
  return '<section class="ban"><div class="w"><h1>Không tìm thấy trang</h1><p>Trang bạn tìm không tồn tại. Hãy quay lại trang chủ hoặc chọn một dịch vụ.</p><a class="btn" href="?page=">Về trang chủ</a></div></section>';
}

function getPageMetadata(route, page) {
  if (page.notFound) {
    return {
      title: "Không tìm thấy trang | Ocean Web",
      description: "Trang bạn tìm không tồn tại."
    };
  }

  if (page.cmsPage) {
    return {
      title:
        page.cmsPage.seoTitle ||
        SEO.pages[route]?.title ||
        cmsData.site.settings?.defaultSeoTitle ||
        page.cmsPage.title,
      description:
        page.cmsPage.seoDescription ||
        SEO.pages[route]?.description ||
        cmsData.site.settings?.defaultSeoDescription ||
        page.cmsPage.intro
    };
  }

  if (page.project) {
    return {
      title: `${page.project.title} | Dự án thiết kế website | Ocean Web`,
      description: page.project.description
    };
  }

  if (page.industry) {
    return SEO.pages[route];
  }

  if (page.category) {
    return SEO.pages[route];
  }

  return (
    SEO.pages[route] || {
      title:
        cmsData?.site?.settings?.defaultSeoTitle || SEO.defaultTitle,
      description:
        cmsData?.site?.settings?.defaultSeoDescription ||
        SEO.defaultDescription
    }
  );
}

function setMeta(selector, attribute, value) {
  const element = document.querySelector(selector);
  if (element) {
    element.setAttribute(attribute, value);
  }
}

function setCanonical(route, notFound) {
  const canonical = document.querySelector('link[rel="canonical"]');

  if (!productionOrigin || notFound) {
    canonical?.remove();
    return;
  }

  const element = canonical || document.createElement("link");
  const pageQuery = route ? `?page=${encodeURIComponent(route)}` : "";

  element.rel = "canonical";
  element.href = `${productionOrigin}/${pageQuery}`;

  if (!canonical) {
    document.head.append(element);
  }
}

function createStructuredData(route, page) {
  const brandName =
    cmsData?.site?.settings?.brandName ||
    cmsData?.site?.name ||
    "Ocean Web";
  const organization = {
    "@type": "Organization",
    name: brandName,
    description:
      cmsData?.site?.settings?.defaultSeoDescription ||
      SEO.defaultDescription
  };
  const website = {
    "@type": "WebSite",
    name: brandName,
    inLanguage: "vi-VN",
    publisher: organization
  };
  const graph = [organization, website];

  if (productionOrigin) {
    organization["@id"] = `${productionOrigin}/#organization`;
    organization.url = `${productionOrigin}/`;
    website["@id"] = `${productionOrigin}/#website`;
    website.url = `${productionOrigin}/`;
    website.publisher = { "@id": organization["@id"] };
  }

  if (page.service) {
    const provider = { "@type": "Organization", name: brandName };
    if (productionOrigin) {
      provider["@id"] = organization["@id"];
    }

    graph.push({
      "@type": "Service",
      name: page.industry?.title || page.service.title,
      description:
        page.industry?.description ||
        SEO.pages[route]?.description ||
        page.service.description,
      provider
    });

    if (!page.cmsPage) {
      const questions = page.industry?.questions || page.service.questions;
      graph.push({
        "@type": "FAQPage",
        mainEntity: questions.map(([question, answer]) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: {
            "@type": "Answer",
            text: answer
          }
        }))
      });
    }
  }

  if (page.notFound) {
    return null;
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph
  };
}

function updatePageHead(route, page) {
  const metadata = getPageMetadata(route, page);
  const structuredData = createStructuredData(route, page);

  document.title = metadata.title;
  setMeta('meta[name="description"]', "content", metadata.description);
  const cmsKeywords =
    page.cmsPage?.focusKeywords ||
    (route === ""
      ? cmsData?.site?.settings?.focusKeywords || []
      : []);
  let keywordsElement = document.querySelector('meta[name="keywords"]');
  if (cmsKeywords.length) {
    if (!keywordsElement) {
      keywordsElement = document.createElement("meta");
      keywordsElement.name = "keywords";
      document.head.append(keywordsElement);
    }
    keywordsElement.content = cmsKeywords.join(", ");
  } else if (keywordsElement) {
    keywordsElement.remove();
  }
  setMeta(
    'meta[name="robots"]',
    "content",
    page.notFound ? "noindex,follow" : "index,follow"
  );
  setMeta('meta[property="og:title"]', "content", metadata.title);
  setMeta('meta[property="og:description"]', "content", metadata.description);
  setMeta(
    'meta[property="og:type"]',
    "content",
    "website"
  );
  setMeta('meta[name="twitter:title"]', "content", metadata.title);
  setMeta('meta[name="twitter:description"]', "content", metadata.description);
  if (productionOrigin && !page.notFound) {
    setMeta(
      'meta[property="og:url"]',
      "content",
      `${productionOrigin}/?page=${encodeURIComponent(route)}`
    );
  } else {
    document.querySelector('meta[property="og:url"]')?.remove();
  }

  setCanonical(route, page.notFound);

  const structuredDataElement = document.getElementById("structured-data");
  if (structuredDataElement) {
    structuredDataElement.remove();
  }

  if (structuredData) {
    const script = document.createElement("script");
    script.id = "structured-data";
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(structuredData);
    document.head.append(script);
  }
}

function updateActiveNavigation(route) {
  const links = [...document.querySelectorAll("nav a[data-k]")];
  const activeLink = links
    .filter((link) => {
      const key = link.dataset.k;
      return route === key || (key && route.startsWith(`${key}/`));
    })
    .sort((first, second) => second.dataset.k.length - first.dataset.k.length)[0];

  links.forEach((link) => {
    const isActive = link === activeLink;
    link.classList.toggle("on", isActive);

    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function updateContactInformation() {
  const settings = cmsData?.site?.settings || {};
  const contact = {
    ...CONTACT,
    phone: settings.phone || CONTACT.phone,
    email: settings.email || CONTACT.email,
    address: settings.address || CONTACT.address,
    zalo: settings.zaloUrl || CONTACT.zalo
  };
  document.querySelectorAll("[data-c]").forEach((element) => {
    const value = contact[element.dataset.c];
    if (value) {
      element.textContent = value;
    }
  });

  const phoneLink = document.getElementById("fp");
  phoneLink.href = `tel:${formatPhone(contact.phone)}`;
  phoneLink.textContent = `📞 ${contact.phone}`;

  const emailLink = document.getElementById("fm");
  emailLink.href = `mailto:${contact.email}`;
  emailLink.textContent = `✉️ ${contact.email}`;

  const zaloLink = document.getElementById("zl");
  zaloLink.href = contact.zalo;

  const phoneButton = document.getElementById("tl2");
  phoneButton.href = `tel:${formatPhone(contact.phone)}`;
}

function updateCounters() {
  document.querySelectorAll("[data-n]").forEach((element) => {
    const target = Number(element.dataset.n);
    const suffix = element.dataset.s || "";

    if (reduceMotion.matches) {
      element.textContent = `${target}${suffix}`;
      return;
    }

    const start = performance.now();
    const duration = 1300;

    function step(timestamp) {
      const progress = Math.min((timestamp - start) / duration, 1);
      element.textContent = `${Math.round(target * progress)}${
        progress === 1 ? suffix : ""
      }`;

      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    }

    window.requestAnimationFrame(step);
  });
}

function updateProjectCovers(container = app) {
  container.querySelectorAll("[data-project]").forEach((element) => {
    const project = PROJECTS.find(
      (item) => item.id === element.dataset.project
    );

    if (project) {
      element.style.backgroundImage = `linear-gradient(135deg,${project.gradient})`;
    }
  });
}

function renderRoute({ focusHeading = true } = {}) {
  const route = getRoute();
  const page = getPage(route);

  document.body.classList.toggle("home-route", route === "");

  app.innerHTML = page.html;
  updateProjectCovers();
  updatePageHead(route, page);
  updateActiveNavigation(route);
  updateContactInformation();

  nav.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Mở menu điều hướng");

  if (focusHeading) {
    const heading = app.querySelector("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }

  window.scrollTo(0, 0);
  updateHeaderAppearance();

  const contactForm = document.getElementById("f");
  if (contactForm) {
    contactForm.addEventListener("submit", handleContactForm);
  }

  initDomainTools();
  initProjectFilters();
  updateCounters();
}

function updateHeaderAppearance() {
  header.classList.toggle("is-scrolled", window.scrollY > 8);
}

function initProjectFilters() {
  const filters = document.querySelector(".fl");
  const projectList = document.getElementById("pl");

  if (!filters || !projectList) {
    return;
  }

  filters.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) {
      return;
    }

    filters.querySelectorAll("button").forEach((filter) => {
      const isActive = filter === button;
      filter.classList.toggle("on", isActive);
      filter.setAttribute("aria-pressed", String(isActive));
    });

    const category = button.textContent.trim();
    const projects = PROJECTS.filter(
      (project) => category === "Tất cả" || project.category === category
    );

    projectList.innerHTML = projects.map(renderProjectCard).join("");
    updateProjectCovers(projectList);
  });
}

function handleContactForm(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);
  const status = document.getElementById("msg");
  const name = String(formData.get("name") || "").trim();
  const phone = String(formData.get("phone") || "").trim();

  if (!name || !/^[0-9+\s.-]{8,}$/.test(phone)) {
    status.style.color = "#ffd37a";
    status.textContent = "Vui lòng nhập họ tên và số điện thoại hợp lệ.";
    return;
  }

  status.textContent =
    "Cảm ơn bạn! Đang mở ứng dụng email để gửi yêu cầu…";

  const message = [
    `Dịch vụ: ${formData.get("sv")}`,
    `Họ tên: ${name}`,
    `Điện thoại: ${phone}`,
    `Email: ${formData.get("mail") || ""}`,
    `Ghi chú: ${formData.get("note") || ""}`
  ].join("\n");
  const subject = encodeURIComponent(`Tư vấn từ ${name}`);
  const body = encodeURIComponent(message);

  const email = cmsData?.site?.settings?.email || CONTACT.email;
  window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
  form.reset();
}

function initNavigation() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href*="?page="]');
    if (!link || event.defaultPrevented || event.button !== 0) {
      return;
    }

    const destination = new URL(link.href, window.location.href);
    if (
      destination.origin !== window.location.origin ||
      destination.pathname !== window.location.pathname ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    window.history.pushState({}, "", destination);
    renderRoute();
  });

  menuButton.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.setAttribute(
      "aria-label",
      isOpen ? "Đóng menu điều hướng" : "Mở menu điều hướng"
    );
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.classList.contains("open")) {
      nav.classList.remove("open");
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-label", "Mở menu điều hướng");
      menuButton.focus();
    }
  });

  window.addEventListener("scroll", updateHeaderAppearance, { passive: true });
  window.addEventListener("popstate", () => renderRoute());
  window.addEventListener("hashchange", () => renderRoute());
}

function initialize() {
  loadCmsData().then(() => {
    renderRoute({ focusHeading: false });
  });

  const websiteMenu = document.getElementById("website-menu");
  websiteMenu.innerHTML = [
    '<a href="?page=bang-gia">Bảng giá thiết kế website</a>',
    ...WEBSITE_INDUSTRIES.map(
      (industry) =>
        `<a href="?page=dich-vu/thiet-ke-website/${industry.slug}">${industry.title}</a>`
    )
  ].join("");

  const serviceMenu = document.getElementById("dd");
  serviceMenu.innerHTML = [
    ...SERVICES.filter((service) => service.slug !== "thiet-ke-website").map(
      (service) =>
        `<a href="?page=dich-vu/${service.slug}">${service.icon} ${service.title}</a>`
    ),
    '<a href="?page=quy-trinh">Quy trình làm việc</a>',
    '<a href="?page=ten-mien">Tên miền & Hosting</a>'
  ].join("");

  const blogMenu = document.getElementById("blog-menu");
  blogMenu.innerHTML = BLOG_GROUPS.map(
    (group) =>
      `<div class="blog-menu-group"><h2>${group.title}</h2>${group.categories
        .map(
          (category) =>
            `<a href="?page=blog/${category.slug}">${category.title}</a>`
        )
        .join("")}</div>`
  ).join("");

  const footerServices = document.getElementById("fs");
  footerServices.innerHTML = SERVICES.map(
    (service) =>
      `<a href="?page=dich-vu/${service.slug}">${service.icon} ${service.title}</a>`
  ).join("");

  updateContactInformation();
  initNavigation();
  initCopyProtection();
}

initialize();
