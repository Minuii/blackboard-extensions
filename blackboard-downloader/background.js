// Downloads files and puts them in "Blackboard/<course>/<folder path>/" inside the Downloads folder.
const pending = new Map(); // url -> queue of sub-directories (same file can be saved twice)

const clean = (s) =>
  (s || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80)
    .replace(/[. ]+$/, "") || "untitled"; // Windows rejects names ending in a dot or space

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const key = pending.has(item.url) ? item.url : item.finalUrl;
  const queue = pending.get(key);
  if (!queue?.length) return; // not ours
  const dir = queue.shift();
  if (!queue.length) pending.delete(key);
  suggest({ filename: `${dir}/${clean(item.filename)}`, conflictAction: "uniquify" });
});

const enqueue = (url, dir) => (pending.get(url) ?? pending.set(url, []).get(url)).push(dir);

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== "download") return;
  (async () => {
    const root = ["Blackboard", clean(msg.course)];
    const jobs = [];
    // layout: "folders" = keep Blackboard's folders, "flat" = one "All Files" folder, "both" = both copies
    if (msg.layout !== "flat")
      for (const f of msg.files) jobs.push({ url: f.url, dir: [...root, ...(f.path || []).map(clean)].join("/") });
    if (msg.layout !== "folders")
      for (const f of msg.files) jobs.push({ url: f.url, dir: [...root, "All Files"].join("/") });

    let ok = 0;
    for (const j of jobs) {
      enqueue(j.url, j.dir);
      try {
        await chrome.downloads.download({ url: j.url, conflictAction: "uniquify", saveAs: false });
        ok++;
      } catch (e) {
        pending.get(j.url)?.pop();
        console.warn("Download failed", j.url, e);
      }
      await new Promise((r) => setTimeout(r, 250)); // be gentle with the server
    }
    // Remember what was downloaded here (not in the popup, which may be closed by now) for the "New only" filter.
    // ponytail: grows forever (~100 bytes per file); prune if it ever nears the 10 MB storage cap
    const { done = [] } = await chrome.storage.local.get("done");
    await chrome.storage.local.set({ done: [...new Set([...done, ...msg.files.map((f) => f.url)])] });
    reply({ ok, total: jobs.length });
  })();
  return true;
});
