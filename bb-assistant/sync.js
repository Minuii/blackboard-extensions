// sync.js — shared by the side panel (manual sync) and the background worker (timed sync).
import { collectAll } from './bb.js';
import { allAnnouncements } from './ai.js';

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || {};
}

export async function saveSettings(patch) {
  const s = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: s });
  return s;
}

export async function getSnapshot() {
  const { snapshot } = await chrome.storage.local.get('snapshot');
  return snapshot || null;
}

export async function hasOriginPermission(origin) {
  return chrome.permissions.contains({ origins: [origin + '/*'] });
}

export async function runSync(onProgress) {
  const s = await getSettings();
  if (!s.origin) throw new Error('Set your Blackboard address in Settings first.');
  if (!(await hasOriginPermission(s.origin))) {
    throw new Error('The extension has no permission for ' + s.origin + '. Open Settings and press "Save & allow access".');
  }
  const prev = await getSnapshot();
  const snap = await collectAll(s.origin, s.selectedCourseIds, onProgress);
  const prevIds = new Set(prev ? allAnnouncements(prev).map((a) => a.id) : []);
  // Only courses that were already synced can have "new" announcements; a course you just ticked
  // would otherwise report its whole history as new.
  const prevCourses = new Set(prev ? prev.courses.map((c) => c.id) : []);
  const fresh = prev
    ? allAnnouncements(snap).filter((a) => !prevIds.has(a.id) && (a.courseId == null || prevCourses.has(a.courseId)))
    : [];
  await chrome.storage.local.set({ snapshot: snap });
  return { snap, fresh };
}
