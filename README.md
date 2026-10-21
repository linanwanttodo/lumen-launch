# Lumen launch

A compact launcher for GNOME Shell 50, inspired by macOS Spotlight.

> **Origin — a fork of Spotlight.** Lumen launch is the second-generation
> development ("二次开发") of the original **Spotlight** extension
> (`spotlight@ninx`, original repo: <https://github.com/itsnin/spotlight>).
> We kept its clean single-card design and search engine, then rebuilt it under
> a new name with new features. The original extension was written by itsnin;
> this project is an independent fork. See [Origin & Credits](#origin--credits)
> below.

**repo:** https://github.com/linanwanttodo/lumen-launch
**version:** 20.10.2026

## shortcut

ctrl + space

## features

- **fuzzy app search** — type an app name or abbreviation, `ffx` finds Firefox
- **two result layouts** — classic list rows or an icon grid (5x4, Launchpad style), switchable in Preferences → Appearance
- **all apps** — when the search box is empty, shows every installed app, most-used first
- **6 color themes** — Dark, Light, Nord, Dracula, One Dark, Solarized Light, switchable in preferences
- **inline calculator** — type `12 * 8 + 3`, press Enter to copy the result to the clipboard
- **system actions** — lock, suspend, restart, shutdown, logout, switch user
- **settings search** — type `wifi`, `bluetooth`, `display` … to jump straight to that GNOME settings panel (matches English and Chinese panel names)
- **file and folder search** — searches Desktop, Documents, Downloads, Pictures, Music, Videos, and Templates; results are ranked by filename match
- **web search fallback** — only when nothing else matches (Google / DuckDuckGo / Brave / Bing / Startpage)
- **Chinese input support** — works with fcitx5/IBus preedit in the search box
- always opens centered on the primary monitor

## how to use

open it with ctrl + space then just start typing

| what you want | what to do |
|---|---|
| open lumen | ctrl + space |
| launch an app | type the name or abbreviation then enter |
| do math | type the expression then enter |
| lock screen | type lock then enter |
| open wifi settings | type wifi then enter |
| search the web | type something with no app matches then enter |
| move up down | arrow keys |
| close | esc |

## themes

choose one in *Preferences → Appearance → Theme*

| theme | palette |
|---|---|
| Dark | macOS-like `#1c1c1e` |
| Light | light `#f6f6f7` |
| Nord | `#2e3440` blue-gray |
| Dracula | `#282a36` purple |
| One Dark | `#282c34` |
| Solarized Light | `#fdf6e3` warm paper |

## install

### one-click (from the repo)

```bash
git clone https://github.com/linanwanttodo/lumen-launch.git
cd lumen-launch
./install.sh
```

then log out and back in (required on wayland so the shell picks up the
new uuid) and the extension will be enabled. uninstall with
`./install.sh --uninstall`.

### from a release zip (extensions.gnome.org)

```bash
gnome-extensions install ~/Downloads/lumen-launch@linanwanttodo.github.io.zip
# then log out and back in if you are on wayland
gnome-extensions enable lumen-launch@linanwanttodo.github.io
```

or install manually

```bash
cd ~/Downloads
unzip lumen-launch@linanwanttodo.github.io.zip -d lumen-launch@linanwanttodo.github.io
mkdir -p ~/.local/share/gnome-shell/extensions/
mv lumen-launch@linanwanttodo.github.io ~/.local/share/gnome-shell/extensions/
```

then log out and back in and run

```bash
gnome-extensions enable lumen-launch@linanwanttodo.github.io
```

## preferences

open with

```bash
gnome-extensions prefs lumen-launch@linanwanttodo.github.io
```

you can change

- the keyboard shortcut
- the color theme
- the results layout (list or icon grid)
- popup width
- max results per category (All, or a fixed number)
- web search engine
- toggle web search on or off

## architecture

`extension.js` and `prefs.js` stay at the repo root - GNOME Shell (and the
extensions website zip upload) requires them there. the implementation lives
under `src/`:

- `src/popup/` - popup widgets (shell process)
- `src/search/` - search providers and matching (shell process)
- `src/keybinding.js` - keybinding manager
- `src/prefs/` - preferences pages (they run in a separate GTK process and
  must not import shell-only libraries like St, Clutter, Meta or Shell)

each file has a single responsibility

| file | what it does |
|---|---|
| `extension.js` | entry point, creates popup and registers keybinding |
| `prefs.js` | preferences window entry point |
| `src/popup/spotlightPopup.js` | main popup widget: open/close, search, rendering, theme, centering |
| `src/popup/searchEntry.js` | search entry with magnifying glass icon |
| `src/popup/resultsContainer.js` | scrollable results area |
| `src/popup/resultRow.js` | builds a single result row with icon and text |
| `src/popup/resultTile.js` | builds a single grid tile (icon + label) for the grid layout |
| `src/popup/gridLayout.js` | pure grid geometry: fixed 5-column layout, tile width, whole-row viewport height |
| `src/popup/noResults.js` | empty state widget |
| `src/search/appSearch.js` | fuzzy app search + full app list (most-used first) via Shell.AppSystem/AppUsage |
| `src/search/fileSearch.js` | home-directory file and folder search |
| `src/search/calculatorSearch.js` | arithmetic evaluation and clipboard copy |
| `src/search/systemActionsSearch.js` | system actions via the Shell SystemActions singleton |
| `src/search/settingsSearch.js` | GNOME settings panel search (bilingual) |
| `src/search/webSearch.js` | web search fallback |
| `src/search/searchController.js` | orchestrates all search providers and combines results |
| `src/search/calculator.js` | recursive descent arithmetic parser |
| `src/search/fuzzyMatcher.js` | fuzzy string matching with scoring |
| `src/keybinding.js` | keybinding manager using Mutter `grab_accelerator` (works in any app) |
| `src/prefs/shortcutPage.js` | keyboard shortcut capture |
| `src/prefs/appearancePage.js` | theme, results layout, popup width, max results |
| `src/prefs/webSearchPage.js` | search engine picker |
| `src/prefs/aboutPage.js` | about section |

## design

- single rounded card like Ulauncher: container draws background + radius + shadow,
  entry and results are transparent and seamless
- all themes are plain solid rounded cards (no backdrop blur)
- list view shows 5 whole rows, grid view shows up to 4 whole rows; the viewport is sized to whole rows and scrolls beyond that
- always centered on the primary monitor
- 600px wide by default

## origin & credits

Lumen launch is a **second-generation development of the original Spotlight
extension**:

- **original project:** Spotlight (`spotlight@ninx`), written by **itsnin**,
  source at <https://github.com/itsnin/spotlight>
- Lumen launch continues that work: rebranded, theming added (6 rofi-style
  color schemes), most-used apps list, file/folder search, bilingual settings
  matching, and various bug fixes
- the extension is distributed under the same license as the original

If you came from the old Spotlight extension: your popup layout and core search
behaviour are unchanged — the new name and themes are additions, not a rewrite.

## data access

To find files, the extension reads filenames and file types under the standard
user directories listed above. It never reads file contents, and it makes no
network requests except when you activate a web search result or open an
online link. The only clipboard access is the user-initiated calculator copy.

## license

gpl-3.0-or-later see the license file
