# Blackboard Assistant

A Chromium extension (Opera, Chrome, Edge, Brave) that opens as a small window. It reads your Blackboard (courses, announcements,
chapters/content, homework deadlines, grades) and lets you chat about all of it.

**No API key needed in Chrome**: chat uses Chrome's built-in on-device AI (Gemini Nano, desktop Chrome 138+,
about 22 GB free disk and 16 GB RAM or a 4 GB GPU; the model downloads once on first use). In other browsers,
or for longer and smarter answers, paste an optional DeepSeek key in Settings.

## Install (2 minutes)
1. Unzip this folder somewhere permanent (do not delete it afterwards).
2. Open `opera://extensions` (or `chrome://extensions`), switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `bb-assistant` folder.
4. Click the extension icon (pin it from the puzzle-piece menu). The assistant opens in a small window.

## Set up
1. Log in to Blackboard normally in a browser tab.
2. In the window: **Settings** -> paste your Blackboard address (e.g. `https://yourschool.blackboard.com`,
   or press **Use tab** while on Blackboard), press **Save & allow access**. (DeepSeek key is optional.)
3. It syncs automatically. Ask things like "what's due this week?", "summarize my announcements",
   "explain the entropy chapter".

## How it works / privacy
- Uses Blackboard's official REST API with your existing browser login. Your password is never seen.
- Synced data (and the key, if you add one) is stored only in this browser (`chrome.storage.local`).
- Without a key, chat runs on your computer and nothing leaves it. With a key, chat messages plus a text
  summary of your Blackboard data are sent to `api.deepseek.com`, and nowhere else.
- The on-device model has a small memory, so without a key it sees a shortened summary (latest 15 announcements,
  25 deadlines, 20 items per course).
- Background check for new announcements runs on the interval you pick (needs you to stay logged in).

## Limits
- Reads text and titles. Attached PDFs, slides and videos are not read.
- Some universities hide parts of the API from students (grades, deadlines). Settings -> Diagnostics shows what was blocked.
- Re-login when the badge shows a red "!" (your Blackboard session expired).
