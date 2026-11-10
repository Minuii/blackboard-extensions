# Blackboard browser extensions

Two Chromium extensions (Chrome, Edge, Brave, Opera) for Blackboard. Released under the [MIT License](LICENSE).

| Extension | Folder | What it does |
|---|---|---|
| Blackboard Assistant | [`bb-assistant/`](bb-assistant) | Reads your courses, announcements, content and deadlines, and lets you chat about them. No API key needed in Chrome (built-in AI); DeepSeek key optional. |
| Blackboard Bulk Downloader | [`blackboard-downloader/`](blackboard-downloader) | Scans a Blackboard course page and downloads the files you tick in one click. |

## Reinstall on a new computer

1. Clone this repo (or download it as a ZIP and unzip it somewhere permanent; Chrome loads the extension from that folder, so don't delete it afterwards):
   ```
   git clone https://github.com/Minuii/bb-extensions.git
   ```
2. Open `chrome://extensions` (Edge: `edge://extensions`, Opera: `opera://extensions`) and switch on **Developer mode**.
3. Click **Load unpacked** and choose the extension's folder: `bb-assistant` or `blackboard-downloader`.
4. Pin the extension icon to the toolbar.

Each folder has its own README with setup and usage details.

## Notes

- **No secrets are stored in this repo.** The Assistant's optional DeepSeek API key is entered in its Settings tab and kept in the browser's local storage, so you need to paste it in again after reinstalling.
