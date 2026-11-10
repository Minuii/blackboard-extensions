// ai.js — turns your Blackboard snapshot into context and talks to the AI
// (Chrome's built-in on-device model by default, DeepSeek if a key is set).

const STOP = new Set(('the a an and or of to in on for with about what whats is are was were do does did my me i you ' +
  'it this that these those can could would should please tell show give explain summarize summary week today ' +
  'tomorrow chapter chapters lecture lectures next last when which how any all new from have has had there their ' +
  'into out than then them they we our us be been being as at by if not but so').split(' '));

function fmt(iso) {
  if (!iso) return 'n/a';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function words(q) {
  return (q || '')
    .toLowerCase()
    .split(/[^a-z0-9؀-ۿ]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

export function collectDeadlines(snap) {
  const out = [];
  const seen = new Set();
  const add = (title, when, course, src) => {
    if (!when) return;
    const key = (title || '').toLowerCase().slice(0, 40) + '|' + when.slice(0, 10);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title, when, course, src });
  };
  const courseByCal = {};
  for (const c of snap.courses) courseByCal[c.id] = c.name;
  for (const c of snap.courses) {
    for (const g of c.gradebook || []) if (g.due) add(g.name, g.due, c.name, 'gradebook');
    for (const i of c.contents || []) if (i.dueHint) add(i.title, i.dueHint, c.name, 'assignment');
  }
  for (const e of snap.calendar || []) {
    const when = e.end || e.start;
    const course = courseByCal[e.calendarId] || (e.calendarId ? e.calendarId : null);
    add(e.title, when, course, e.type || 'calendar');
  }
  return out.sort((a, b) => Date.parse(a.when) - Date.parse(b.when));
}

export function allAnnouncements(snap) {
  const rows = [];
  for (const c of snap.courses) for (const a of c.announcements || []) rows.push({ ...a, course: c.name });
  for (const a of snap.systemAnnouncements || []) rows.push({ ...a, course: 'University-wide' });
  return rows.sort((a, b) => Date.parse(b.created || 0) - Date.parse(a.created || 0));
}

// Answers the everyday questions (deadlines, grades, announcements) straight from the synced data:
// no AI and no network. Returns null for anything else, which then goes to the AI.
// ponytail: keyword matching, so unusual phrasings fall through to the AI; add patterns as they come up
export function localAnswer(snap, question) {
  const q = (question || '').toLowerCase();
  if (!snap || /summar|explain/.test(q)) return null;
  const now = Date.now(), DAY = 86400000;
  const kw = words(q);
  const hit = snap.courses.filter((c) => kw.some((w) => `${c.name} ${c.courseId}`.toLowerCase().includes(w))).map((c) => c.name);
  const inCourse = (name) => !hit.length || hit.includes(name);
  const scope = hit.length ? ` for ${hit.join(', ')}` : '';
  const endOfDay = (offset) => new Date(new Date().setHours(23, 59, 59, 999)).getTime() + offset * DAY;

  // "due/deadline/overdue" always mean dates. Bare nouns ("what is assignment 3 about?") only count
  // with a listing/time word, so content questions still reach the AI.
  if (/\b(due|deadlines?|overdue|submit)\b/.test(q) ||
      (/\b(homeworks?|assignments?|quiz(zes)?|exams?|midterms?)\b/.test(q) &&
       /\b(when|open|upcoming|left|soon|today|tonight|tomorrow|week|month|any|which|list|show|pending|next|coming|late|missed)\b/.test(q))) {
    const past = /overdue|late|missed/.test(q);
    const [until, label] = /today|tonight/.test(q) ? [endOfDay(0), 'today']
      : /tomorrow/.test(q) ? [endOfDay(1), 'by tomorrow']
      : /month/.test(q) ? [now + 30 * DAY, 'in the next 30 days']
      : /week|soon/.test(q) ? [now + 7 * DAY, 'in the next 7 days']
      : [Infinity, 'coming up'];
    const rows = collectDeadlines(snap).filter((d) => {
      const t = Date.parse(d.when);
      return inCourse(d.course) && (past ? t < now && t > now - 14 * DAY : t >= now && t <= until);
    }).slice(0, 20);
    if (!rows.length) return past ? `Nothing overdue in the last 14 days${scope}.` : `Nothing due ${label}${scope}.`;
    return `**${past ? 'Overdue (last 14 days)' : 'Due ' + label}${scope}:**\n` +
      rows.map((d) => `- **${fmt(d.when)}** — ${d.title}${d.course ? ` (${d.course})` : ''}`).join('\n');
  }

  if (/\b(grade|score|mark)s?\b/.test(q)) {
    const lines = [];
    for (const c of snap.courses) {
      if (!inCourse(c.name)) continue;
      const g = (c.gradebook || []).filter((x) => x.myScore != null);
      if (g.length) lines.push(`**${c.name}**\n` + g.map((x) => `- ${x.name}: ${x.myScore}${x.possible ? '/' + x.possible : ''}`).join('\n'));
    }
    return lines.length ? lines.join('\n') : `No grades found${scope}. (Some universities hide them from this kind of access.)`;
  }

  if (/\b(announcements?|news|miss(ed)?)\b/.test(q)) {
    const week = /\b(week|miss(ed)?)\b/.test(q);
    const rows = allAnnouncements(snap)
      .filter((a) => inCourse(a.course) && (!week || Date.parse(a.created) > now - 7 * DAY)).slice(0, 10);
    if (!rows.length) return `No announcements${week ? ' in the last 7 days' : ''}${scope}.`;
    return `**${week ? 'Announcements from the last 7 days' : 'Latest announcements'}${scope}:**\n` +
      rows.map((a) => `- **${a.course}** — ${a.title} *(${fmt(a.created)})*: ${(a.body || '').replace(/\s+/g, ' ').slice(0, 220)}`).join('\n');
  }
  return null;
}

export function buildContext(snap, question, maxChars = 120000) {
  if (!snap) return 'No Blackboard data has been synced yet.';
  const now = new Date();
  const small = maxChars < 40000; // on-device model: tiny context window, so send far less
  const parts = [];
  parts.push(`Today: ${fmt(now.toISOString())} (timezone ${Intl.DateTimeFormat().resolvedOptions().timeZone}).`);
  parts.push(`Student: ${snap.user.name}. Data last synced: ${fmt(snap.fetchedAt)}.`);

  const deadlines = collectDeadlines(snap).filter((d) => Date.parse(d.when) > now - 2 * 86400000).slice(0, small ? 25 : 60);
  parts.push('\n## DEADLINES / CALENDAR (sorted by date)');
  parts.push(
    deadlines.length
      ? deadlines.map((d) => `- ${fmt(d.when)} — ${d.title}${d.course ? ` [${d.course}]` : ''}`).join('\n')
      : '(none found)'
  );

  const annAll = allAnnouncements(snap);
  const ann = annAll.slice(0, small ? 15 : 150);
  const perCourse = {};
  for (const a of annAll) perCourse[a.course] = (perCourse[a.course] || 0) + 1;
  const bodyLen = small ? 200 : annAll.length > 60 ? 350 : annAll.length > 30 ? 600 : 1000;
  parts.push(
    `\n## ANNOUNCEMENTS (newest first) — ${annAll.length} in total` +
      (annAll.length ? ` (${Object.entries(perCourse).map(([k, v]) => `${k}: ${v}`).join('; ')})` : '')
  );
  parts.push(
    ann.length
      ? ann.map((a) => `- [${a.course}] ${fmt(a.created)} — ${a.title}\n  ${(a.body || '').replace(/\n/g, ' ').slice(0, bodyLen)}`).join('\n')
      : '(none found)'
  );

  // Keyword retrieval: attach full text of the most relevant items.
  // (Placed before the long course outline so a size cut-off trims the outline, not this.)
  const kw = words(question);
  if (kw.length) {
    const scored = [];
    for (const c of snap.courses) {
      for (const i of c.contents || []) {
        if (!i.body || i.body.length < 40) continue;
        const hay = (i.path + ' ' + i.body).toLowerCase();
        let s = 0;
        for (const w of kw) {
          if (i.title.toLowerCase().includes(w)) s += 5;
          if (hay.includes(w)) s += 1;
        }
        if (s > 0) scored.push({ s, c, i });
      }
    }
    scored.sort((a, b) => b.s - a.s);
    const top = scored.slice(0, small ? 2 : 4);
    if (top.length) {
      parts.push('\n## MOST RELEVANT MATERIAL FOR THIS QUESTION (full text)');
      for (const { c, i } of top) parts.push(`\n### ${c.name} › ${i.path}\n${i.body.slice(0, small ? 2000 : 4500)}`);
    }
  }

  parts.push('\n## COURSES, MATERIALS AND GRADES');
  for (const c of snap.courses) {
    parts.push(`\n### ${c.name} (${c.courseId})`);
    const grades = (c.gradebook || []).filter((g) => g.myScore != null);
    if (grades.length) {
      parts.push('Grades: ' + grades.map((g) => `${g.name}: ${g.myScore}${g.possible ? '/' + g.possible : ''}`).join('; '));
    }
    const items = (c.contents || []).slice(0, small ? 20 : 150);
    parts.push(
      items.length
        ? 'Content outline:\n' + items.map((i) => `- ${i.path} {${i.kind}}`).join('\n')
        : 'Content outline: (nothing readable)'
    );
  }

  let text = parts.join('\n');
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…(truncated)';
  return text;
}

export const SYSTEM_PROMPT =
  'You are a study assistant built into the student\'s browser. You can see a snapshot of their Blackboard ' +
  '(announcements, deadlines, course content outline, grades) below. Rules: answer from this data; if something ' +
  'is not in it, say so plainly and suggest re-syncing or checking Blackboard instead of guessing. Always name the ' +
  'course an item belongs to and give exact dates/times. When asked for announcements, list every announcement in ' +
  'the data (the section heading states how many exist) unless the student asks for a subset, and say how many you ' +
  'listed. Be concise and practical, use short lists for deadlines. ' +
  'You can only see text and titles, not the contents of attached PDFs/slides/videos. When asked to explain a ' +
  'chapter or topic, use the material text if provided, otherwise explain from general knowledge and say that you did so.';

// ---------- No API key: the browser's own on-device model (Chrome's Prompt API, Gemini Nano) ----------
const LM_OPTS = { expectedOutputs: [{ type: 'text', languages: ['en'] }] };
const NO_LOCAL_AI = 'Add a DeepSeek API key in Settings to chat (Overview, deadlines and notifications work without one).';

// 'available' | 'downloadable' | 'downloading' | 'unavailable'
export async function builtInState() {
  if (typeof LanguageModel === 'undefined') return 'unavailable';
  try { return await LanguageModel.availability(LM_OPTS); } catch { return 'unavailable'; }
}

async function* streamBuiltIn({ messages, signal, onStatus }) {
  const state = await builtInState();
  if (state === 'unavailable') {
    throw new Error(typeof LanguageModel === 'undefined'
      ? 'This browser has no built-in AI (it needs desktop Chrome 138 or newer). ' + NO_LOCAL_AI
      : 'Chrome\'s built-in AI cannot run on this computer (it needs about 22 GB of free disk and 16 GB RAM or a 4 GB GPU). ' + NO_LOCAL_AI);
  }
  const session = await LanguageModel.create({
    ...LM_OPTS,
    signal,
    initialPrompts: messages.slice(0, -1),
    monitor(m) {
      if (state !== 'available') m.addEventListener('downloadprogress', (e) =>
        onStatus?.(`Downloading Chrome's AI model (one time)… ${Math.round(e.loaded * 100)}%`));
    }
  });
  try {
    for await (const piece of session.promptStreaming(messages.at(-1).content, { signal })) yield piece;
  } catch (e) {
    if (e.name === 'QuotaExceededError') throw new Error('That is too much text for the on-device AI. Clear the chat or ask a narrower question.');
    throw e;
  } finally {
    session.destroy();
  }
}

// With an API key: DeepSeek (big context, better answers). Without: the on-device model.
export async function* streamChat({ apiKey, model, messages, signal, onStatus }) {
  if (!apiKey) { yield* streamBuiltIn({ messages, signal, onStatus }); return; }
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: model || 'deepseek-chat', messages, stream: true, temperature: 0.3 })
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error.message; } catch { /* ignore */ }
    if (res.status === 401) throw new Error('DeepSeek rejected the API key (401). Check it in Settings.');
    if (res.status === 402) throw new Error('DeepSeek says your balance is insufficient (402). Top up your account.');
    throw new Error(`DeepSeek error ${res.status}${detail ? ': ' + detail : ''}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith('data:')) continue;
      const data = l.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const delta = JSON.parse(data).choices[0].delta;
        if (delta && delta.content) yield delta.content;
      } catch { /* partial JSON, skip */ }
    }
  }
}
