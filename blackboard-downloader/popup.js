const $ = (id) => document.getElementById(id);
let result = null;
let cacheKey = null;      // last scan of this tab is kept for the browser session, so reopening is instant
let done = new Set();     // urls downloaded before
const types = new Set();  // file-type chips switched on (none = show every type)
let newOnly = false;
let shift = false, last = null; // shift-click range selection

const ext = (f) => {
  const m = f.name.match(/\.([a-z0-9]{1,5})$/i) || f.url.split("?")[0].match(/\.([a-z0-9]{1,5})$/i);
  return m && /[a-z]/i.test(m[1]) ? m[1].toLowerCase() : "other"; // "Notes v2.0" is not a ".0" file
};
const make = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

(async () => {
  const s = await chrome.storage.local.get(["deep", "layout", "done"]);
  if (s.deep !== undefined) $("deep").checked = s.deep;
  if (s.layout) $("layout").value = s.layout;
  done = new Set(s.done || []);
  const tab = await activeTab();
  if (!tab?.url) return;
  cacheKey = "scan:" + tab.url;
  const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
  if (cached) { result = cached; render(); }
})();
$("deep").onchange = () => chrome.storage.local.set({ deep: $("deep").checked });
$("layout").onchange = () => chrome.storage.local.set({ layout: $("layout").value });

$("scan").onclick = async () => {
  const tab = await activeTab();
  const t0 = Date.now();
  $("status").textContent = "Scanning…";
  $("scan").disabled = true;
  try {
    const [{ result: r }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: bbScanPage,
      args: [$("deep").checked],
    });
    if (!r) throw new Error("the page did not answer. Reload the Blackboard tab and try again.");
    result = r;
    types.clear(); newOnly = false; $("filter").value = "";
    if (cacheKey) chrome.storage.session.set({ [cacheKey]: r }).catch(() => {});
    render(((Date.now() - t0) / 1000).toFixed(1));
  } catch (e) {
    $("status").textContent = "Couldn't scan this tab: " + e.message;
  }
  $("scan").disabled = false;
};

function chip(label, toggle) {
  const b = make("button", "chip", label);
  b.setAttribute("aria-pressed", "false");
  b.onclick = () => { b.setAttribute("aria-pressed", String(toggle())); apply(); };
  $("types").append(b);
}

function render(secs) {
  const { files, course, mode } = result;
  const list = $("list");
  list.textContent = "";
  $("types").textContent = "";
  for (const id of ["toolbar", "types", "foot"]) $(id).classList.toggle("hidden", !files.length);
  if (!files.length) {
    $("status").textContent = "No files found here. Open a course's content area (e.g. Course Content / Lectures) and scan again.";
    return;
  }
  $("status").textContent = `${files.length} file(s) in “${course}” · ${mode}` + (secs ? ` · ${secs}s` : " · saved scan");

  const counts = {};
  for (const f of files) counts[ext(f)] = (counts[ext(f)] || 0) + 1;
  for (const [t, n] of Object.entries(counts).sort((a, b) => b[1] - a[1]))
    chip(`${t} ${n}`, () => (types.delete(t) ? false : !!types.add(t)));
  if (files.some((f) => done.has(f.url))) chip("New only", () => (newOnly = !newOnly));

  const groups = {};
  files.forEach((f, i) => (groups[f.path.join(" / ") || "This page"] ??= []).push(i));
  Object.keys(groups).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach((g, gi) => {
    const head = make("label", "group");
    head.innerHTML = `<input type="checkbox" data-g="${gi}" checked>`;
    head.append(make("span", "", g), make("small", "tag", groups[g].length));
    head.title = "Select / deselect this whole folder";
    list.append(head);
    for (const i of groups[g]) {
      const f = files[i];
      const row = make("label", "file");
      row.dataset.g = gi;
      row.dataset.ext = ext(f);
      row.dataset.search = `${f.name} ${g} ${ext(f)}`.toLowerCase();
      row.innerHTML = `<input type="checkbox" data-i="${i}" checked>`;
      row.append(make("span", "", f.name));
      row.title = f.name;
      if (done.has(f.url)) row.append(make("small", "tag saved", "saved"));
      if (ext(f) !== "other") row.append(make("small", "tag", ext(f)));
      list.append(row);
    }
  });
  last = null;
  apply();
}

const boxes = () => [...document.querySelectorAll("#list .file input")];
const visible = (b) => !b.parentElement.classList.contains("hidden");
const shown = () => boxes().filter(visible);

// Show/hide rows for the current text filter + chips.
function apply() {
  const words = $("filter").value.toLowerCase().split(/\s+/).filter(Boolean);
  for (const b of boxes()) {
    const r = b.parentElement;
    r.classList.toggle("hidden", !(
      words.every((w) => r.dataset.search.includes(w)) &&
      (!types.size || types.has(r.dataset.ext)) &&
      !(newOnly && done.has(result.files[+b.dataset.i].url))));
  }
  sync();
}

// Folder checkboxes + download button follow the ticked, visible files.
function sync() {
  const byGroup = {};
  for (const b of shown()) (byGroup[b.parentElement.dataset.g] ??= []).push(b.checked);
  for (const g of document.querySelectorAll("#list .group")) {
    const cb = g.firstChild, v = byGroup[cb.dataset.g] || [], n = v.filter(Boolean).length;
    g.classList.toggle("hidden", !v.length);
    cb.checked = n > 0 && n === v.length;
    cb.indeterminate = n > 0 && n < v.length;
  }
  const n = shown().filter((b) => b.checked).length;
  $("go").disabled = n === 0;
  $("go").textContent = n ? `Download ${n} file${n > 1 ? "s" : ""}` : "Select files";
}

$("list").onmousedown = (e) => (shift = e.shiftKey);
$("list").onchange = (e) => {
  const t = e.target;
  if (t.dataset.g) {
    shown().filter((b) => b.parentElement.dataset.g === t.dataset.g).forEach((b) => (b.checked = t.checked));
  } else {
    const v = shown(), a = v.indexOf(last), z = v.indexOf(t);
    if (shift && a >= 0) v.slice(Math.min(a, z), Math.max(a, z) + 1).forEach((b) => (b.checked = t.checked));
    last = t;
  }
  shift = false;
  sync();
};

$("all").onclick = () => { shown().forEach((b) => (b.checked = true)); sync(); };
$("none").onclick = () => { boxes().forEach((b) => (b.checked = false)); sync(); };
$("invert").onclick = () => { shown().forEach((b) => (b.checked = !b.checked)); sync(); };
$("filter").oninput = apply;

$("go").onclick = async () => {
  const picked = shown().filter((b) => b.checked).map((b) => result.files[+b.dataset.i]);
  $("go").disabled = true;
  $("go").textContent = `Downloading ${picked.length}…`;
  let r;
  try {
    r = await chrome.runtime.sendMessage({
      type: "download", course: result.course, files: picked, layout: $("layout").value,
    });
  } catch (e) {
    $("status").textContent = "Download failed to start: " + e.message;
    sync();
    return;
  }
  for (const f of picked) done.add(f.url); // background.js saves this list
  $("go").textContent = `Done: ${r.ok}/${r.total} started ✓`;
  $("status").textContent = `Saved to Downloads/Blackboard/${result.course}/`;
};
