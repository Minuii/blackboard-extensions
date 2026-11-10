import { runSync, getSettings } from './sync.js';

const ALARM = 'bb-auto-sync';
const PANEL_URL = 'sidepanel.html';

// Works in Opera, Chrome, Edge, Brave: the icon opens the assistant in its own small window.
chrome.action.onClicked.addListener(async () => {
  const { winId } = await chrome.storage.session.get('winId').catch(() => ({}));
  if (winId) {
    try {
      await chrome.windows.update(winId, { focused: true });
      return;
    } catch { /* window was closed, open a new one */ }
  }
  const w = await chrome.windows.create({
    url: chrome.runtime.getURL(PANEL_URL),
    type: 'popup',
    width: 440,
    height: 760
  });
  chrome.storage.session.set({ winId: w.id }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(scheduleFromSettings);
chrome.runtime.onStartup.addListener(scheduleFromSettings);

async function scheduleFromSettings() {
  const s = await getSettings();
  await chrome.alarms.clear(ALARM);
  const mins = Number(s.syncMinutes);
  if (s.origin && mins >= 15) chrome.alarms.create(ALARM, { periodInMinutes: mins, delayInMinutes: 1 });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) scheduleFromSettings();
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== ALARM) return;
  try {
    const { fresh } = await runSync();
    await chrome.action.setBadgeText({ text: '' });
    const s = await getSettings();
    if (s.notify !== false && fresh.length) {
      const first = fresh[0];
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: fresh.length === 1 ? `New announcement: ${first.course}` : `${fresh.length} new Blackboard announcements`,
        message: fresh.length === 1 ? first.title : fresh.slice(0, 3).map((f) => `${f.course}: ${f.title}`).join('\n')
      });
    }
  } catch (e) {
    if (e.name === 'AuthError') {
      chrome.action.setBadgeBackgroundColor({ color: '#c0392b' });
      chrome.action.setBadgeText({ text: '!' });
    }
  }
});
