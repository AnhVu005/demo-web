const DOMAIN_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const DOMAIN_LOOKUP_MESSAGE =
  "Không kết nối được dịch vụ tra cứu. Vui lòng thử lại sau.";

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

async function fetchJson(url, options) {
  const response = await fetch(url, options);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Lookup request failed: ${response.status}`);
  }

  return response.json();
}

function normalizeDomain(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/\.$/, "");
}

function formatDate(date) {
  return date ? escapeHtml(date.slice(0, 10)) : "—";
}

function getRegistrar(data) {
  const entity = (data.entities || []).find((item) =>
    (item.roles || []).includes("registrar")
  );
  const name = entity?.vcardArray?.[1]?.find((field) => field[0] === "fn");

  return name?.[3] ? escapeHtml(name[3]) : "—";
}

function getNameservers(data) {
  return (data.nameservers || [])
    .map((server) => escapeHtml(String(server.ldhName || "").toLowerCase()))
    .filter(Boolean)
    .join(", ");
}

function registrarLinks(domain) {
  const query = encodeURIComponent(domain);

  return `<a class="mini" target="_blank" rel="noopener noreferrer" href="https://www.namecheap.com/domains/registration/results/?domain=${query}">Namecheap</a><a class="mini" target="_blank" rel="noopener noreferrer" href="https://www.godaddy.com/domainsearch/find?domainToCheck=${query}">GoDaddy</a>`;
}

function renderDomainResult(result) {
  const domain = escapeHtml(result.domain);

  if (result.error) {
    return `<div class="rw"><div><b>${domain}</b><small>Không tra cứu tự động được. Vui lòng thử lại sau.</small></div><span class="bx nt">CHƯA RÕ</span>${registrarLinks(result.domain)}</div>`;
  }

  if (result.manualLookup) {
    return `<div class="rw"><div><b>${domain}</b><small>Tên miền .vn tra cứu chính thức tại VNNIC</small></div><span class="bx nt">TRA TẠI VNNIC</span><a class="mini" target="_blank" rel="noopener noreferrer" href="https://whois.vnnic.vn">Mở VNNIC</a></div>`;
  }

  if (result.available) {
    return `<div class="rw"><div><b>${domain}</b><small>Tên miền còn trống, có thể đăng ký</small></div><span class="bx ok">CÒN TRỐNG</span>${registrarLinks(result.domain)}</div>`;
  }

  return `<div class="rw"><div><b>${domain}</b><small>Nhà đăng ký: ${result.registrar}<br>Đăng ký: ${result.registered}<br>Hết hạn: ${result.expires}<br>Nameserver: ${result.nameservers || "—"}</small></div><span class="bx no">ĐÃ ĐĂNG KÝ</span></div>`;
}

async function lookupDomain(domain) {
  if (domain.endsWith(".vn")) {
    return { domain, manualLookup: true };
  }

  try {
    const data = await fetchJson(
      `https://rdap.org/domain/${encodeURIComponent(domain)}`
    );

    if (!data) {
      return { domain, available: true };
    }

    const events = data.events || [];
    const getEventDate = (eventName) =>
      events.find((event) => event.eventAction === eventName)?.eventDate;

    return {
      domain,
      registrar: getRegistrar(data),
      registered: formatDate(getEventDate("registration")),
      expires: formatDate(getEventDate("expiration")),
      nameservers: getNameservers(data)
    };
  } catch {
    return { domain, error: true };
  }
}

async function getHostingInformation(domain) {
  const options = { headers: { accept: "application/dns-json" } };
  const lookupDns = (type) =>
    fetchJson(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`,
      options
    );
  const [addressResponse, nameserverResponse] = await Promise.all([
    lookupDns("A"),
    lookupDns("NS")
  ]);
  const addresses = (addressResponse?.Answer || [])
    .filter((answer) => answer.type === 1)
    .map((answer) => escapeHtml(answer.data));
  const nameservers = (nameserverResponse?.Answer || [])
    .filter((answer) => answer.type === 2)
    .map((answer) => escapeHtml(answer.data));

  let provider = "—";
  if (addresses[0]) {
    const record = await fetchJson(
      `https://rdap.org/ip/${encodeURIComponent(addresses[0])}`
    );

    if (record) {
      provider = escapeHtml(
        `${record.name || "—"}${record.country ? ` (${record.country})` : ""}`
      );
    }
  }

  return { addresses, nameservers, provider };
}

function displayLookupError(element) {
  element.innerHTML = `<div class="rw" role="status">${DOMAIN_LOOKUP_MESSAGE}</div>`;
}

function initializeDomainAvailabilityForm() {
  const form = document.getElementById("dq");
  const input = document.getElementById("dn");
  const result = document.getElementById("dr");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const value = normalizeDomain(input.value);
    if (!value) {
      result.innerHTML = '<div class="rw" role="status">Vui lòng nhập tên miền.</div>';
      return;
    }

    const extensions = [...document.querySelectorAll(".tlds input:checked")]
      .map((checkbox) => checkbox.value)
      .filter((extension) => /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(extension));
    const domains = value.includes(".")
      ? [value]
      : extensions.map((extension) => `${value}.${extension}`);

    if (!domains.length || !domains.every((domain) => DOMAIN_PATTERN.test(domain))) {
      result.innerHTML =
        '<div class="rw" role="status">Tên miền không hợp lệ hoặc chưa chọn đuôi tên miền.</div>';
      return;
    }

    result.innerHTML = '<div class="rw" role="status">Đang tra cứu…</div>';

    const lookups = await Promise.all(domains.map(lookupDomain));
    result.innerHTML = lookups.map(renderDomainResult).join("");
  });
}

function renderHostingResult(domain, information) {
  const safeDomain = escapeHtml(domain);

  if (!information.addresses.length) {
    return `<div class="rw"><div><b>${safeDomain}</b><small>Không tìm thấy bản ghi A, tên miền chưa trỏ về máy chủ nào.</small></div><span class="bx nt">CHƯA TRỎ</span></div>`;
  }

  return `<div class="rw"><div><b>${safeDomain}</b><small>IP máy chủ: ${information.addresses.join(", ")}<br>Nhà cung cấp mạng / host: ${information.provider}<br>Nameserver: ${information.nameservers.join(", ") || "—"}</small></div><span class="bx ok">ĐANG HOẠT ĐỘNG</span></div>`;
}

function initializeHostingLookupForm() {
  const form = document.getElementById("hq");
  const input = document.getElementById("hn");
  const result = document.getElementById("hr");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const domain = normalizeDomain(input.value);
    if (!DOMAIN_PATTERN.test(domain)) {
      result.innerHTML =
        '<div class="rw" role="status">Vui lòng nhập tên miền hợp lệ.</div>';
      return;
    }

    result.innerHTML = '<div class="rw" role="status">Đang kiểm tra…</div>';

    try {
      const information = await getHostingInformation(domain);
      result.innerHTML = renderHostingResult(domain, information);
    } catch {
      displayLookupError(result);
    }
  });
}

export function initDomainTools() {
  if (document.getElementById("dq")) {
    initializeDomainAvailabilityForm();
  }

  if (document.getElementById("hq")) {
    initializeHostingLookupForm();
  }
}
