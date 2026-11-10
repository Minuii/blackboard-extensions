import { normalizeOrigin, isDefaultSelected } from './bb.js';
import { buildContext, SYSTEM_PROMPT, streamChat, builtInState, localAnswer, collectDeadlines, allAnnouncements } from './ai.js';
import { getSettings, saveSettings, getSnapshot, runSync, hasOriginPermission } from './sync.js';

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids) if (k) n.append(k);
  return n;
}

function when(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function ago(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

/* ---------- tiny, safe markdown ---------- */
function md(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const blocks = [];
  let text = esc(src).replace(/```[a-z]*\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push('<pre><code>' + code + '</code></pre>');
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const out = [];
  let list = false;
  for (const line of text.split('\n')) {
    const li = line.match(/^\s*[-*•]\s+(.*)/) || line.match(/^\s*\d+[.)]\s+(.*)/);
    if (li) {
      if (!list) { out.push('<ul>'); list = true; }
      out.push('<li>' + inline(li[1]) + '</li>');
      continue;
    }
    if (list) { out.push('</ul>'); list = false; }
    const h = line.match(/^#{1,6}\s+(.*)/);
    if (h) out.push('<p><strong>' + inline(h[1]) + '</strong></p>');
    else if (line.trim()) out.push('<p>' + inline(line) + '</p>');
  }
  if (list) out.push('</ul>');
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
}

/* ---------- tabs ---------- */
function showTab(name) {
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* ---------- state ---------- */
let snapshot = null;
let settings = {};
let chat = [];
let aborter = null;

function setStatus(t) { $('status').textContent = t; }
function refreshStatus() {
  if (!settings.origin) setStatus('Set up your Blackboard address in Settings');
  else if (!snapshot) setStatus('Not synced yet — press Sync');
  else setStatus(`Synced ${ago(snapshot.fetchedAt)} · ${snapshot.courses.length} courses · ${allAnnouncements(snapshot).length} announcements`);
}

/* ---------- sync ---------- */
async function doSync() {
  const btn = $('syncBtn');
  btn.disabled = true;
  try {
    const { snap, fresh } = await runSync((m) => setStatus(m));
    snapshot = snap;
    renderOverview();
    renderCourseList();
    renderDiag();
    refreshStatus();
    if (fresh.length) addMsg('assistant', `📢 **${fresh.length} new announcement${fresh.length > 1 ? 's' : ''}** since your last sync:\n` +
      fresh.slice(0, 5).map((a) => `- **${a.course}** — ${a.title}`).join('\n'));
  } catch (e) {
    if (e.name === 'AuthError') {
      addMsg('error', 'Blackboard says you are not logged in. Open Blackboard in a tab, log in, then press Sync again.');
    } else if (e.status === 404 || /^404/.test(e.message)) {
      addMsg('error', 'Blackboard answered "not found". Check the address in Settings (it should be just the site, e.g. https://lms.university.edu).');
    } else {
      addMsg('error', e.message);
    }
    refreshStatus();
  } finally {
    btn.disabled = false;
  }
}
$('syncBtn').addEventListener('click', doSync);

/* ---------- overview ---------- */
function renderOverview() {
  const root = $('overview');
  root.textContent = '';
  if (!snapshot) { root.append(el('p', { class: 'muted', text: 'Sync to see your data.' })); return; }
  const now = Date.now();

  root.append(el('div', { class: 'ovh', text: 'Deadlines' }));
  const dl = collectDeadlines(snapshot).filter((d) => Date.parse(d.when) > now - 3 * 86400000).slice(0, 25);
  if (!dl.length) root.append(el('p', { class: 'muted', text: 'No deadlines found. (Some universities do not expose them to students.)' }));
  for (const d of dl) {
    const t = Date.parse(d.when);
    const cls = t < now ? 'card overdue' : t - now < 3 * 86400000 ? 'card soon' : 'card';
    root.append(el('div', { class: cls }, el('div', { class: 't', text: d.title }),
      el('div', { class: 's', text: `${when(d.when)}${d.course ? ' · ' + d.course : ''}` })));
  }

  const an = allAnnouncements(snapshot);
  root.append(el('div', { class: 'ovh', text: `Announcements (${an.length})` }));
  if (!an.length) root.append(el('p', { class: 'muted', text: 'No announcements found.' }));
  for (const a of an) {
    root.append(el('details', {}, el('summary', { text: a.title }),
      el('div', { class: 's muted', text: `${a.course} · ${a.created ? when(a.created) : ''}` }),
      el('p', { text: a.body || '(empty)' })));
  }

  root.append(el('div', { class: 'ovh', text: 'Courses' }));
  for (const c of snapshot.courses) {
    const ul = el('ul');
    for (const i of (c.contents || []).filter((x) => x.kind !== 'folder').slice(0, 60)) {
      ul.append(el('li', { text: i.path }));
    }
    const grades = (c.gradebook || []).filter((g) => g.myScore != null);
    const det = el('details', {}, el('summary', { text: c.name }),
      el('div', { class: 's muted', text: `${(c.contents || []).length} items · ${(c.announcements || []).length} announcements` }));
    if (grades.length) det.append(el('p', { text: 'Grades: ' + grades.map((g) => `${g.name} ${g.myScore}${g.possible ? '/' + g.possible : ''}`).join(' · ') }));
    det.append(ul);
    det.append(el('a', { href: c.url, target: '_blank', rel: 'noopener', text: 'Open in Blackboard' }));
    root.append(det);
  }
}

/* ---------- chat ---------- */
function addMsg(role, text, persist = true) {
  const n = el('div', { class: 'msg ' + (role === 'user' ? 'user' : role === 'error' ? 'error' : '') });
  if (role === 'user' || role === 'error') n.textContent = text;
  else n.innerHTML = md(text);
  $('messages').append(n);
  $('messages').scrollTop = $('messages').scrollHeight;
  if (persist && role !== 'error') {
    chat.push({ role, content: text });
    chat = chat.slice(-40);
    chrome.storage.local.set({ chat });
  }
  return n;
}

async function send(question) {
  question = question.trim();
  if (!question) return;
  $('chips').hidden = true;
  addMsg('user', question);
  $('input').value = '';
  // Deadlines, grades and announcement lists are answered from the synced data: no AI, no network.
  const quick = localAnswer(snapshot, question);
  if (quick) { addMsg('assistant', `${quick}\n\n*From your Blackboard data, synced ${ago(snapshot.fetchedAt)}.*`); return; }
  // ponytail: fixed 16k-char budget for the on-device model (~9k-token window); read session.contextWindow if it grows
  const local = !settings.apiKey;
  const history = chat.slice(local ? -5 : -11, -1).filter((m) => m.role === 'user' || m.role === 'assistant');
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT + '\n\n--- BLACKBOARD DATA ---\n' + buildContext(snapshot, question, local ? 16000 : 120000) },
    ...history,
    { role: 'user', content: question }
  ];
  const bubble = addMsg('assistant', '…', false);
  $('sendBtn').disabled = true;
  $('stopBtn').hidden = false;
  aborter = new AbortController();
  let acc = '';
  let raf = 0;
  try {
    for await (const piece of streamChat({ apiKey: settings.apiKey, model: settings.model, messages, signal: aborter.signal, onStatus: setStatus })) {
      acc += piece;
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        bubble.innerHTML = md(acc);
        $('messages').scrollTop = $('messages').scrollHeight;
      });
    }
    bubble.innerHTML = md(acc || '(no answer)');
    chat.push({ role: 'assistant', content: acc });
    chat = chat.slice(-40);
    chrome.storage.local.set({ chat });
  } catch (e) {
    if (e.name === 'AbortError') {
      bubble.innerHTML = md(acc || '(stopped)');
      if (acc) { chat.push({ role: 'assistant', content: acc }); chrome.storage.local.set({ chat }); }
    } else {
      bubble.remove();
      addMsg('error', e.message, false);
    }
  } finally {
    $('sendBtn').disabled = false;
    $('stopBtn').hidden = true;
    aborter = null;
    refreshStatus();
  }
}

$('chatForm').addEventListener('submit', (e) => { e.preventDefault(); send($('input').value); });
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('input').value); }
});
$('stopBtn').addEventListener('click', () => aborter && aborter.abort());
$('clearChat').addEventListener('click', () => {
  chat = [];
  chrome.storage.local.set({ chat });
  $('messages').textContent = '';
  $('chips').hidden = false;
});
document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => send(c.textContent)));

/* ---------- settings ---------- */
async function loadSettingsUI() {
  $('origin').value = settings.origin || '';
  $('apiKey').value = settings.apiKey || '';
  $('model').value = settings.model || 'deepseek-chat';
  $('syncMinutes').value = String(settings.syncMinutes ?? 60);
  $('notify').checked = settings.notify !== false;
  $('aiState').textContent = {
    available: '✓ Built-in AI is ready. No key needed.',
    downloadable: 'Built-in AI will download once (a few GB) the first time you ask something. No key needed.',
    downloading: 'Built-in AI is downloading… No key needed.',
    unavailable: 'Built-in AI is not available in this browser or on this computer, so chat needs a DeepSeek key below.'
  }[await builtInState()];
}

$('showKey').addEventListener('click', () => {
  const k = $('apiKey');
  k.type = k.type === 'password' ? 'text' : 'password';
  $('showKey').textContent = k.type === 'password' ? 'Show' : 'Hide';
});

$('useTab').addEventListener('click', async () => {
  try {
    const tabs = await chrome.tabs.query({ windowType: 'normal' });
    const looksBb = (t) => /blackboard|\/ultra\/|\/webapps\/|\/learn\/api|lms/i.test(t.url || '');
    const tab = tabs.find((t) => t.active && looksBb(t)) || tabs.find(looksBb) || tabs.find((t) => t.active);
    const o = tab && tab.url ? normalizeOrigin(tab.url) : null;
    if (o && /^https?:/.test(o)) $('origin').value = o;
    else $('saveMsg').textContent = 'Could not read that tab. Paste the address instead.';
  } catch {
    $('saveMsg').textContent = 'Could not read that tab. Paste the address instead.';
  }
});

$('saveBtn').addEventListener('click', async () => {
  const origin = normalizeOrigin($('origin').value);
  if (!origin) { $('saveMsg').textContent = 'That address does not look valid.'; return; }
  // Must be called straight from the click (user gesture).
  const granted = await chrome.permissions.request({ origins: [origin + '/*'] });
  if (!granted) { $('saveMsg').textContent = 'Access was not granted, so Blackboard cannot be read.'; return; }
  settings = await saveSettings({
    origin,
    apiKey: $('apiKey').value.trim(),
    model: $('model').value,
    syncMinutes: Number($('syncMinutes').value),
    notify: $('notify').checked
  });
  $('saveMsg').textContent = 'Saved ✓';
  setTimeout(() => ($('saveMsg').textContent = ''), 2500);
  refreshStatus();
  if (!snapshot) { showTab('chat'); doSync(); }
});

function renderCourseList() {
  const box = $('courseList');
  box.textContent = '';
  $('courseTools').hidden = !snapshot;
  if (!snapshot) return;

  // Quick-select buttons: Current / All / None, then one per term (most recently used term first).
  const presets = $('coursePresets');
  presets.textContent = '';
  const byId = Object.fromEntries(snapshot.allCourses.map((c) => [c.id, c]));
  const preset = (label, test) => {
    const b = el('button', { class: 'chip', type: 'button', text: label });
    b.addEventListener('click', () => box.querySelectorAll('input').forEach((cb) => (cb.checked = test(byId[cb.value]))));
    presets.append(b);
  };
  preset('Current', isDefaultSelected);
  preset('All', () => true);
  preset('None', () => false);
  for (const t of new Set(snapshot.allCourses.map((c) => c.term).filter(Boolean))) preset(t, (c) => c.term === t);

  const sel = new Set(settings.selectedCourseIds && settings.selectedCourseIds.length
    ? settings.selectedCourseIds
    : snapshot.allCourses.filter(isDefaultSelected).map((c) => c.id));
  for (const c of snapshot.allCourses) {
    const cb = el('input', { type: 'checkbox', value: c.id });
    cb.checked = sel.has(c.id);
    box.append(el('label', { class: 'courseRow' }, cb, el('span', { text: c.name }),
      c.term ? el('span', { class: 'muted', text: c.term }) : null));
  }
  $('applyCourses').hidden = false;
  $('courseSearch').dispatchEvent(new Event('input')); // re-apply the search after a re-render
}

$('courseSearch').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  for (const r of $('courseList').children) r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
});

$('applyCourses').addEventListener('click', async () => {
  const ids = [...$('courseList').querySelectorAll('input:checked')].map((i) => i.value);
  settings = await saveSettings({ selectedCourseIds: ids });
  doSync();
  showTab('chat');
});

function renderDiag() {
  const box = $('diag');
  box.textContent = '';
  if (!snapshot || !snapshot.diagnostics) { box.textContent = 'Nothing yet.'; return; }
  const bad = snapshot.diagnostics.filter((d) => !d.ok);
  if (!bad.length) { box.textContent = 'All Blackboard requests succeeded.'; return; }
  box.append(el('div', { text: 'Some data your university does not expose (this is normal for students):' }));
  for (const d of bad.slice(0, 25)) box.append(el('div', { class: 'diagRow bad', text: `• ${d.label}: ${d.error}` }));
}

$('wipe').addEventListener('click', async () => {
  if (!confirm('Delete your settings, synced data and chat history from this browser?')) return;
  await chrome.storage.local.clear();
  settings = {}; snapshot = null; chat = [];
  $('messages').textContent = '';
  $('chips').hidden = false;
  await loadSettingsUI();
  renderOverview(); renderCourseList(); renderDiag(); refreshStatus();
});

/* ---------- boot ---------- */
(async function init() {
  settings = await getSettings();
  snapshot = await getSnapshot();
  const stored = await chrome.storage.local.get('chat');
  chat = stored.chat || [];
  await loadSettingsUI();
  renderOverview(); renderCourseList(); renderDiag(); refreshStatus();

  if (chat.length) {
    $('chips').hidden = true;
    for (const m of chat) addMsg(m.role, m.content, false);
  } else {
    addMsg('assistant',
      settings.origin
        ? 'Hi! Ask me about your announcements, deadlines, homework or chapters.'
        : 'Hi! Open **Settings** to add your Blackboard address, then I can read your courses.', false);
  }
  if (!settings.origin) showTab('settings');

  // Quietly refresh if the data is stale.
  if (settings.origin && (await hasOriginPermission(settings.origin))) {
    const stale = !snapshot || Date.now() - Date.parse(snapshot.fetchedAt) > 30 * 60000;
    if (stale) doSync();
  }
  setInterval(refreshStatus, 60000);
})();
