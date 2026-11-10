# Blackboard Bulk Downloader (Chrome / Edge / Brave)

Scan a Blackboard course page, tick the files you want, and download them all in one click.
Files are saved to `Downloads/Blackboard/<Course>/<Folder>/…`.

## Install
1. Unzip this folder.
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and pick the `blackboard-downloader` folder.
5. Pin the blue icon to your toolbar.

## Use
1. Log in to Blackboard and open a course content page (e.g. "Course Content", "Lectures").
2. Click the extension icon, then **Scan this page**.
   - Keep **include subfolders** ticked to also grab files inside folders.
3. Narrow it down:
   - Type in the filter box (e.g. `week 3`).
   - Click the file-type chips (`pdf`, `pptx`, …) to show only those types.
   - **New only** hides files you already downloaded (those are tagged *saved*).
   - Tick a folder name to select or clear the whole folder; Shift-click to tick a range.
   - **All / None / Invert** act on the files currently shown.

   The last scan of a page is remembered until you close the browser, so reopening the popup is instant.
4. Pick **Save as**:
   - **Both** (default): keeps Blackboard's folders *and* puts a copy of every file in one `All Files` folder.
   - **Separate folders only**, or **One "All Files" folder only**.
5. Click **Download N files**.

Tip: if Chrome asks "This site is trying to download multiple files", click **Allow**.
If every file opens a "Save as" box, turn off *Ask where to save each file* in Chrome's download settings.

## Works with
- **Blackboard Learn Original** course view: crawls content folders via the page HTML.
- **Blackboard Ultra** course view: reads the course outline via Blackboard's REST API
  using your logged-in session; falls back to the links visible on the page if your
  school blocks that API.

Nothing leaves your browser. The extension only reads the tab you scan, using your own login.
