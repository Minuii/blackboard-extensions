// bb.js — reads your Blackboard data through the official Learn REST API,
// using the session cookies of the browser you are already logged in with.
// No password is ever seen or stored by this extension.

const P1 = '/learn/api/public/v1';
const P2 = '/learn/api/public/v2';

export function normalizeOrigin(input) {
  if (!input) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : 'https://' + input.trim());
    return u.origin;
  } catch {
    return null;
  }
}

export function stripHtml(html, max = 6000) {
  if (!html) return '';
  let t = String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  if (t.length > max) t = t.slice(0, max) + '…';
  return t;
}

class AuthError extends Error {
  constructor(msg) {
    super(msg || 'Not logged in to Blackboard');
    this.name = 'AuthError';
  }
}

async function getJson(origin, path) {
  const res = await fetch(origin + path, {
    credentials: 'include',
    headers: { Accept: 'application/json' }
  });
  if (res.status === 401 || res.status === 403) {
    const e = new Error(`${res.status} ${path}`);
    e.status = res.status;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(`${res.status} ${path}`);
    e.status = res.status;
    throw e;
  }
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) throw new AuthError(); // login page HTML => not signed in
  return res.json();
}

async function getAll(origin, path, max = 600) {
  let out = [];
  let next = path;
  while (next && out.length < max) {
    const j = await getJson(origin, next);
    out = out.concat(j.results || []);
    next = j.paging && j.paging.nextPage ? j.paging.nextPage : null;
  }
  return out;
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        results[idx] = { __error: e };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// Try several endpoints in order, return the first that works.
async function firstOk(diag, label, attempts) {
  let lastErr;
  for (const fn of attempts) {
    try {
      const v = await fn();
      diag.push({ label, ok: true });
      return v;
    } catch (e) {
      if (e.name === 'AuthError') throw e;
      lastErr = e;
    }
  }
  diag.push({ label, ok: false, error: lastErr ? lastErr.message : 'failed' });
  return null;
}

export function courseUrl(origin, courseId) {
  return `${origin}/ultra/courses/${courseId}/outline`;
}

export function isDefaultSelected(c) {
  const now = Date.now();
  const touched = c.lastAccessed ? Date.parse(c.lastAccessed) : 0;
  const created = c.created ? Date.parse(c.created) : 0;
  const DAY = 86400000;
  if (touched) return now - touched < 400 * DAY;
  return created ? now - created < 500 * DAY : true;
}

export async function listCourses(origin) {
  const me = await getJson(origin, `${P1}/users/me`);
  const memberships = await getAll(origin, `${P1}/users/${me.id}/courses?limit=100&expand=course`);
  // Term names (e.g. "Fall 2026"). Many universities block this for students: then we fall back to the year.
  const termNames = {};
  const termIds = [...new Set(memberships.map((m) => m.course && m.course.termId).filter(Boolean))];
  await pool(termIds, 4, async (id) => { termNames[id] = (await getJson(origin, `${P1}/terms/${id}`)).name; });
  const courses = [];
  for (const m of memberships) {
    let c = m.course;
    if (!c) {
      try {
        c = await getJson(origin, `${P1}/courses/${m.courseId}`);
      } catch {
        continue;
      }
    }
    if (m.availability && m.availability.available === 'No') continue;
    courses.push({
      id: c.id,
      courseId: c.courseId,
      name: c.name || c.courseId,
      role: m.courseRoleId,
      lastAccessed: m.lastAccessed || null,
      created: c.created || null,
      term: termNames[c.termId] || (c.created ? String(new Date(c.created).getFullYear()) : null),
      ultra: c.ultraStatus || null
    });
  }
  courses.sort((a, b) => (Date.parse(b.lastAccessed || 0) || 0) - (Date.parse(a.lastAccessed || 0) || 0));
  return { me, courses };
}

async function collectContents(origin, courseId, diag) {
  const items = [];
  const MAX_ITEMS = 400;
  async function walk(parentId, path, depth) {
    if (items.length >= MAX_ITEMS || depth > 4) return;
    const url = parentId
      ? `${P1}/courses/${courseId}/contents/${parentId}/children?limit=200`
      : `${P1}/courses/${courseId}/contents?limit=200`;
    let rows;
    try {
      rows = await getAll(origin, url);
    } catch (e) {
      if (e.name === 'AuthError') throw e;
      diag.push({ label: `contents ${courseId}/${parentId || 'root'}`, ok: false, error: e.message });
      return;
    }
    for (const r of rows) {
      if (items.length >= MAX_ITEMS) break;
      const handler = (r.contentHandler && r.contentHandler.id) || '';
      const kind = handler.replace('resource/x-bb-', '') || 'item';
      items.push({
        id: r.id,
        parentId: parentId || null,
        title: r.title,
        kind,
        path: path ? path + ' > ' + r.title : r.title,
        body: stripHtml(r.body, 6000),
        created: r.created || null,
        modified: r.modified || null,
        dueHint: (r.contentDetail && r.contentDetail['resource/x-bb-assignment'] && r.contentDetail['resource/x-bb-assignment'].dueDate) || null,
        link: r.contentHandler && r.contentHandler.url ? r.contentHandler.url : null,
        hasChildren: !!r.hasChildren
      });
    }
    const folders = rows.filter((r) => r.hasChildren).slice(0, 60);
    await pool(folders, 4, (f) => walk(f.id, (path ? path + ' > ' : '') + f.title, depth + 1));
  }
  await walk(null, '', 0);
  return items;
}

async function collectAnnouncements(origin, courseId, diag) {
  const rows = await firstOk(diag, `announcements ${courseId}`, [
    () => getAll(origin, `${P1}/courses/${courseId}/announcements?limit=100`, 1000)
  ]);
  return (rows || []).map((a) => ({
    id: a.id,
    courseId,
    title: a.title,
    body: stripHtml(a.body, 2500),
    created: a.created || a.modified || null,
    creator: a.creator || null
  }));
}

async function collectGradebook(origin, courseId, userId, diag) {
  const cols = await firstOk(diag, `gradebook columns ${courseId}`, [
    () => getAll(origin, `${P2}/courses/${courseId}/gradebook/columns?limit=200`, 300),
    () => getAll(origin, `${P2}/course/${courseId}/gradebook/columns?limit=200`, 300)
  ]);
  const grades = await firstOk(diag, `my grades ${courseId}`, [
    () => getAll(origin, `${P2}/courses/${courseId}/gradebook/users/${userId}?limit=200`, 300),
    () => getAll(origin, `${P1}/courses/${courseId}/gradebook/users/${userId}?limit=200`, 300)
  ]);
  const byCol = {};
  for (const g of grades || []) byCol[g.columnId] = g;
  return (cols || []).map((c) => {
    const g = byCol[c.id] || null;
    return {
      id: c.id,
      name: c.name,
      possible: c.score && c.score.possible != null ? c.score.possible : null,
      due: (c.grading && c.grading.due) || null,
      myScore: g ? (g.score != null ? g.score : g.text || null) : null,
      status: g ? g.status || null : null,
      feedback: g && g.feedback ? stripHtml(g.feedback, 500) : null
    };
  });
}

async function collectCalendar(origin, diag) {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const until = new Date(Date.now() + 150 * 86400000).toISOString();
  const rows = await firstOk(diag, 'calendar', [
    () => getAll(origin, `${P1}/calendars/items?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&limit=200`, 600)
  ]);
  return (rows || []).map((r) => ({
    id: r.id,
    type: r.type,
    calendarId: r.calendarId,
    title: r.title,
    description: stripHtml(r.description, 400),
    start: r.start || null,
    end: r.end || null
  }));
}

export async function collectAll(origin, selectedIds, onProgress = () => {}) {
  const diag = [];
  onProgress('Finding your courses…');
  const { me, courses } = await listCourses(origin);
  const pick = selectedIds && selectedIds.length
    ? courses.filter((c) => selectedIds.includes(c.id))
    : courses.filter(isDefaultSelected);
  const chosen = pick.length ? pick : courses.slice(0, 6);

  const snapshot = {
    origin,
    fetchedAt: new Date().toISOString(),
    user: {
      id: me.id,
      userName: me.userName,
      name: me.name ? [me.name.given, me.name.family].filter(Boolean).join(' ') : me.userName
    },
    allCourses: courses,
    courses: [],
    calendar: [],
    diagnostics: diag
  };

  let done = 0;
  const perCourse = await pool(chosen, 3, async (c) => {
    const [contents, announcements, gradebook] = await Promise.all([
      collectContents(origin, c.id, diag),
      collectAnnouncements(origin, c.id, diag),
      collectGradebook(origin, c.id, me.id, diag)
    ]);
    done++;
    onProgress(`Loaded ${done}/${chosen.length}: ${c.name}`);
    return { ...c, url: courseUrl(origin, c.id), contents, announcements, gradebook };
  });
  for (const r of perCourse) {
    if (r && r.__error) {
      if (r.__error.name === 'AuthError') throw r.__error;
      diag.push({ label: 'course', ok: false, error: r.__error.message });
    } else if (r) snapshot.courses.push(r);
  }

  onProgress('Reading university-wide announcements…');
  const sys = await firstOk(diag, 'system announcements', [
    () => getAll(origin, `${P1}/announcements?limit=100`, 300)
  ]);
  snapshot.systemAnnouncements = (sys || []).map((a) => ({
    id: a.id,
    courseId: null,
    title: a.title,
    body: stripHtml(a.body, 2500),
    created: a.created || a.modified || null,
    creator: a.creator || null
  }));

  onProgress('Reading calendar & deadlines…');
  snapshot.calendar = await collectCalendar(origin, diag);
  return snapshot;
}

export { AuthError };
