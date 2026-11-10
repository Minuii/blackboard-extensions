// Injected into the Blackboard tab (runs with the page's login cookies).
// Must be fully self-contained: chrome.scripting serializes this function.
async function bbScanPage(deep) {
  const MAX_PAGES = 400;
  const PARALLEL = 6; // requests in flight at once: fast, but still polite to the server
  const files = new Map(); // url -> {url, name, path}
  const abs = (h, base) => { try { return new URL(h, base).href; } catch { return null; } };
  const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
  const isFile = (u) =>
    /\/bbcswebdav\//i.test(u) ||
    /\/webapps\/blackboard\/execute\/content\/file\?/i.test(u) ||
    /\/attachments\/[^/]+\/download/i.test(u);
  const isFolder = (u) => /\/webapps\/blackboard\/content\/listContent(Editable)?\.jsp\?.*content_id=/i.test(u);
  const add = (url, name, path) => {
    if (!url || files.has(url)) return;
    if (!name) {
      name = url.split("?")[0].split("/").pop() || "file";
      try { name = decodeURIComponent(name); } catch {} // a stray "%" must not abort the whole scan
    }
    files.set(url, { url, name: txt(name), path });
  };

  let active = 0;
  const waiting = [];
  const limit = async (fn) => {
    while (active >= PARALLEL) await new Promise((r) => waiting.push(r));
    active++;
    try { return await fn(); } finally { active--; waiting.shift()?.(); }
  };

  const course =
    txt(document.querySelector("#courseMenu_link, .course-title, #crumb_1, h1")?.textContent) ||
    document.title.split("–")[0].split("-")[0].trim() || "Course";

  // ---------- Ultra course view: use the REST API ----------
  const ultra = location.pathname.match(/\/ultra\/courses\/(_\d+_\d+)/);
  if (ultra) {
    const cid = ultra[1];
    let pages = 0;
    const getAll = async (url) => {
      const out = [];
      while (url && pages++ < MAX_PAGES) {
        const r = await limit(() => fetch(url, { credentials: "include", headers: { Accept: "application/json" } }));
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
        const j = await r.json();
        out.push(...(j.results || []));
        url = j.paging?.nextPage ? abs(j.paging.nextPage, location.origin) : null;
      }
      return out;
    };
    const base = `${location.origin}/learn/api/public/v1/courses/${cid}/contents`;
    try {
      // Every item's attachments and subfolder are fetched at the same time (capped by `limit`).
      const walk = (items, path, depth) => Promise.all(items.map(async (it) => {
        const h = it.contentHandler?.id || "";
        const jobs = [];
        // Links embedded in document/page bodies
        if (it.body) {
          const d = new DOMParser().parseFromString(it.body, "text/html");
          d.querySelectorAll("a[href]").forEach((a) => {
            const u = abs(a.getAttribute("href"), location.origin);
            if (u && isFile(u)) add(u, a.textContent, [...path, it.title]);
          });
        }
        if (/x-bb-file|x-bb-document|x-bb-assignment/.test(h))
          jobs.push(getAll(`${base}/${it.id}/attachments`).then((atts) => {
            for (const a of atts)
              add(`${base}/${it.id}/attachments/${a.id}/download`, a.fileName,
                  /x-bb-file/.test(h) ? path : [...path, it.title]);
          }).catch(() => {}));
        if ((it.hasChildren || /folder|lesson/.test(h)) && (deep || depth === 0))
          jobs.push(getAll(`${base}/${it.id}/children?limit=200`)
            .then((kids) => walk(kids, [...path, it.title], depth + 1)).catch(() => {}));
        await Promise.all(jobs);
      }));
      await walk(await getAll(`${base}?limit=200`), [], 0);
      if (files.size) return { course, files: [...files.values()], mode: "Ultra" };
    } catch (e) {
      console.warn("[BB Downloader] REST scan failed, falling back to page links:", e);
    }
  }

  // ---------- Original course view (and fallback): crawl HTML pages ----------
  const crumb = (doc) =>
    [...doc.querySelectorAll("#breadcrumbs .path li, #breadcrumbs li")]
      .map((li) => txt(li.textContent)).filter(Boolean).slice(1); // drop course name

  const scanDoc = (doc, baseUrl, path) => {
    const area = doc.querySelector("#content_listContainer, #containerdiv, #content") || doc;
    const folders = [];
    area.querySelectorAll("a[href]").forEach((a) => {
      const u = abs(a.getAttribute("href"), baseUrl);
      if (!u) return;
      if (isFile(u)) {
        // Prefer the item title for generic link text like "Download"
        let name = txt(a.textContent);
        if (!name || /^(download|view|open)$/i.test(name))
          name = txt(a.closest("li")?.querySelector("h3")?.textContent) || "";
        add(u, name, path);
      } else if (isFolder(u)) {
        folders.push({ url: u, title: txt(a.textContent) });
      }
    });
    // Same-page iframes (Ultra often wraps Original content in one)
    doc.querySelectorAll("iframe").forEach((f) => {
      try { if (f.contentDocument) scanDoc(f.contentDocument, f.contentWindow.location.href, path); } catch {}
    });
    return folders;
  };

  const visited = new Set([location.href.split("#")[0]]);
  const crawl = async (f) => {
    const key = f.url.split("#")[0];
    if (visited.has(key) || visited.size >= MAX_PAGES) return;
    visited.add(key);
    try {
      const r = await limit(() => fetch(f.url, { credentials: "include" }));
      const doc = new DOMParser().parseFromString(await r.text(), "text/html");
      await Promise.all(scanDoc(doc, f.url, f.path).map((sub) => crawl({ ...sub, path: [...f.path, sub.title] })));
    } catch (e) {
      console.warn("[BB Downloader] could not open folder", f.url, e);
    }
  };
  const here = crumb(document);
  const top = scanDoc(document, location.href, here);
  if (deep) await Promise.all(top.map((f) => crawl({ ...f, path: [...here, f.title] })));
  return { course, files: [...files.values()], mode: ultra ? "Ultra (page links)" : "Original" };
}
