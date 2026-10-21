// spotlight - popup widget
// SPDX-License-Identifier: GPL-3.0-or-later

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {buildSearchEntry} from './searchEntry.js';
import {buildResultsContainer} from './resultsContainer.js';
import {buildResultRow} from './resultRow.js';
import {buildResultTile} from './resultTile.js';
import {buildNoResults} from './noResults.js';
import {
    GRID,
    computeGridMetrics,
    gridViewportHeight,
    visibleGridRows,
} from './gridLayout.js';
import {runSearch, maxResultsFor} from '../search/searchController.js';
import {getAllApps} from '../search/appSearch.js';
import {searchFiles} from '../search/fileSearch.js';

// the popup widget - a vertical box with a search entry and scrollable results
// added to gnome's chrome layer so it floats above all windows
// uses a modal grab to capture all keyboard input while open
//
// grid geometry lives in gridLayout.js. Columns and tile width are derived
// from the real popup width, so the grid stays usable across the whole
// preferences range (400-1200 px). The scroll viewport is always sized to
// whole rows.

const LIST_VISIBLE_ROWS = 5;
const LIST_ROW_MIN_HEIGHT = 48;
const LIST_ROW_MARGIN = 2;
const LIST_PADDING_TOP = 4;
const LIST_PADDING_BOTTOM = 2;

// estimated height of the entry and divider; used only to decide how many
// grid rows fit on short monitors, so a small error is harmless
const CHROME_HEIGHT_ESTIMATE = 60;

// small delay before walking the home directories: typing is never blocked and
// a burst of keystrokes only results in one filesystem scan
const FILE_SEARCH_DELAY_MS = 200;

export const SpotlightPopup = GObject.registerClass(
class SpotlightPopup extends St.BoxLayout {
    _init(extension) {
        super._init({
            vertical: true,
            style_class: 'spotlight-container',
            reactive: true,
            can_focus: true,
            visible: false,
            width: extension._settings.get_int('popup-width'),
        });

        this._settings = extension._settings;
        this._results = [];
        this._selectedIndex = -1;
        this._searchIdleId = 0;
        this._searchToken = 0;
        this._fileSearch = null;
        this._fileSearchTimeoutId = 0;
        this._fileSearchPending = false;
        this._grab = null;
        this._allocationChangedId = 0;
        this._stagePressId = 0;
        this._themeClass = '';
        this._gridColumns = GRID.COLUMNS;
        this._visibleGridRows = GRID.MAX_VISIBLE_ROWS;
        this._opening = false;

        // the frosted theme was removed; migrate any stored value so the
        // card never ends up with an unstyled (transparent) theme class
        if (this._settings.get_string('theme') === 'frosted')
            this._settings.set_string('theme', 'dark');

        this._settings.connectObject(
            'changed::theme', this._updateTheme.bind(this),
            'changed::layout-mode', this._onLayoutModeChanged.bind(this),
            'changed::popup-width', this._onPopupWidthChanged.bind(this),
            this,
        );
        this._updateTheme();
        this._applyWidth();

        const {entryBox, entry} = buildSearchEntry();
        this._entryBox = entryBox;
        this._entry = entry;

        const clutterText = this._entry.clutter_text;
        clutterText.set_x_expand(true);
        clutterText.connectObject(
            'text-changed', this._onTextChanged.bind(this),
            'key-press-event', this._onKeyPress.bind(this),
            this,
        );

        const {resultsScroll, resultsBox} = buildResultsContainer();
        this._resultsScroll = resultsScroll;
        this._resultsBox = resultsBox;

        // thin horizontal line between the search entry and the results,
        // shown only while results are visible
        this._divider = new St.BoxLayout({
            style_class: 'spotlight-divider',
            visible: false,
        });

        this.add_child(this._entryBox);
        this.add_child(this._divider);
        this.add_child(this._resultsScroll);

        this.connectObject(
            'button-press-event', this._onButtonPress.bind(this),
            this,
        );

        Main.layoutManager.addChrome(this);
        this._reposition();
        Main.layoutManager.connectObject(
            'monitors-changed', this._onMonitorsChanged.bind(this),
            this,
        );
    }

    // closes the popup when the user clicks anywhere outside of it
    // (the modal grab redirects clicks to this actor even outside its bounds)
    _onButtonPress(_, event) {
        const [x, y] = event.get_coords();
        if (x < this.x || x > this.x + this.width || y < this.y || y > this.y + this.height)
            this.close();
        return Clutter.EVENT_STOP;
    }

    // applies the selected theme as a style class on the container,
    // e.g. "spotlight-theme-dark"; called on init and on settings change.
    // all themes are plain solid cards - no backdrop blur, so the rounded
    // corners are always clean
    _updateTheme() {
        if (this._themeClass)
            this.remove_style_class_name(this._themeClass);
        this._themeClass = `spotlight-theme-${this._settings.get_string('theme')}`;
        this.add_style_class_name(this._themeClass);
    }

    _isGridMode() {
        return this._settings.get_string('layout-mode') === 'grid';
    }

    // grid geometry for the current popup width. The helper guarantees that a
    // full row, including the gaps and the scrollbar reservation, fits inside
    // the card.
    _gridMetrics() {
        const width = this.width > 0
            ? this.width
            : this._settings.get_int('popup-width');
        return computeGridMetrics(width);
    }

    // applies the configured width, clamped to the primary monitor so the
    // popup can never be wider than the screen. Grid tiles need more
    // horizontal room than list rows, so grid mode also clamps the width up
    // to the grid minimum; that keeps the fixed 5 column layout intact.
    _applyWidth() {
        const monitor = Main.layoutManager.primaryMonitor;
        const preferred = this._settings.get_int('popup-width');
        const maxWidth = monitor ? Math.max(360, monitor.width - 80) : preferred;
        const width = this._isGridMode()
            ? Math.max(preferred, GRID.MIN_POPUP_WIDTH)
            : preferred;
        this.width = Math.min(width, maxWidth);
        this._gridColumns = this._gridMetrics().columns;
        this._reposition();
    }

    // called when the user changes the popup width in preferences. Grid tiles
    // carry pixel widths computed at render time, so the grid has to be
    // rebuilt; list rows only need their viewport recomputed.
    _onPopupWidthChanged() {
        this._applyWidth();
        if (!this.visible || this._results.length === 0)
            return;
        if (this._isGridMode())
            this._renderResults();
        else
            this._updateResultsViewport();
    }

    // monitor geometry can change while the popup is alive (resolution change,
    // scale factor change, monitor unplug). Keep the clamped width, the
    // column count, and the centering in sync.
    _onMonitorsChanged() {
        this._applyWidth();
        if (!this.visible || this._results.length === 0)
            return;
        if (this._isGridMode())
            this._renderResults();
        else
            this._updateResultsViewport();
    }

    _onLayoutModeChanged() {
        // the width depends on the layout mode: grid mode widens the popup
        // to the grid minimum so a full row of five tiles fits
        this._applyWidth();
        this._gridColumns = this._gridMetrics().columns;
        if (!this.visible)
            return;

        // re-render whatever is currently shown with the new layout
        const text = this._entry.get_text();
        if (text.trim().length === 0)
            this._showDefaultResults();
        else
            this._runSearch(text);
    }

    // closes the popup when the user clicks anywhere outside of it.
    // uses a stage-level capture handler because a modal grab may swallow
    // pointer events before they reach the popup actor itself.
    _onStageCapturedEvent(_, event) {
        if (event.type() !== Clutter.EventType.BUTTON_PRESS)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        if (x < this.x || x > this.x + this.width || y < this.y || y > this.y + this.height)
            this.close();
        return Clutter.EVENT_PROPAGATE;
    }

    // recompute center position based on current actual height
    // called whenever results appear or disappear so the popup stays centered
    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        // during early init (before addChrome) there is no monitor and the
        // actor is not in the stage yet; querying its preferred size then
        // triggers a St critical
        if (!monitor || !this.get_stage())
            return;
        // use the ACTUAL width (clamped to the monitor), otherwise the x
        // centering is computed for the wrong width and the popup sits offset
        const popupWidth = this.width > 0 ? this.width : this._settings.get_int('popup-width');
        // prefer the real allocation height (respects the computed viewport,
        // so the popup centers as a "search box + N rows" unit); fall back to
        // the natural height before the actor has been laid out
        const [, naturalHeight] = this.get_preferred_height(popupWidth);
        const allocHeight = this.get_allocation_box().get_height();
        const height = allocHeight > 0 ? allocHeight : naturalHeight;

        const x = monitor.x + Math.floor((monitor.width - popupWidth) / 2);
        const y = monitor.y + Math.floor((monitor.height - height) / 2);
        // keep the card on screen even on very small monitors or with large
        // text scaling, where the natural height can exceed the monitor
        this.set_position(
            Math.max(monitor.x, Math.min(x, monitor.x + monitor.width - popupWidth)),
            Math.max(monitor.y, Math.min(y, monitor.y + monitor.height - height)),
        );
    }

    open() {
        if (this.visible)
            return;

        this._reposition();
        this.show();

        this._grab = Main.pushModal(this, {
            actionMode: Shell.ActionMode.POPUP,
        });

        if (!this._grab)
            console.warn('lumen-launch: could not acquire the modal grab');
        else {
            this._grab.connectObject('notify::state', () => {
                if (this._grab && this._grab.get_state() === Clutter.GrabState.INVALID)
                    this.close();
            }, this);
        }

        // reposition whenever the allocation changes (results grow/shrink)
        this._allocationChangedId = this.connect('notify::allocation', () => {
            this._reposition();
        });

        this._stagePressId = global.stage.connect('captured-event',
            this._onStageCapturedEvent.bind(this));

        // clearing the entry emits text-changed; suppress the handler so the
        // default view is not enumerated and rendered twice on every reopen
        this._opening = true;
        this._entry.set_text('');
        this._opening = false;

        this._showDefaultResults();
        this._entry.grab_key_focus();
    }

    close() {
        if (!this.visible)
            return;

        this._searchToken++;
        this._cancelFileSearch();
        this._opening = false;

        if (this._searchIdleId) {
            GLib.source_remove(this._searchIdleId);
            this._searchIdleId = 0;
        }

        if (this._allocationChangedId) {
            this.disconnect(this._allocationChangedId);
            this._allocationChangedId = 0;
        }

        if (this._stagePressId) {
            global.stage.disconnect(this._stagePressId);
            this._stagePressId = 0;
        }

        if (this._grab) {
            this._grab.disconnectObject(this);
            Main.popModal(this._grab);
            this._grab = null;
        }

        this.hide();
    }

    _onTextChanged() {
        if (this._opening)
            return;

        const text = this._entry.get_text();

        if (this._searchIdleId) {
            GLib.source_remove(this._searchIdleId);
            this._searchIdleId = 0;
        }

        if (text.trim().length === 0) {
            this._showDefaultResults();
            return;
        }

        this._searchIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._searchIdleId = 0;
            this._runSearch(text);
            return GLib.SOURCE_REMOVE;
        });
    }

    // stops any scheduled or running home-directory scan
    _cancelFileSearch() {
        if (this._fileSearchTimeoutId) {
            GLib.source_remove(this._fileSearchTimeoutId);
            this._fileSearchTimeoutId = 0;
        }
        if (this._fileSearch) {
            this._fileSearch.cancel();
            this._fileSearch = null;
        }
        this._fileSearchPending = false;
    }

    // default view with an empty search box: every installed app, most-used
    // first (launchpad style in grid mode, a full app list in list mode).
    // the max-results setting only caps SEARCH results, not this view
    _showDefaultResults() {
        this._searchToken++;
        this._cancelFileSearch();

        this._results = getAllApps();

        if (this._results.length > 0) {
            this._renderResults();
        } else {
            this._results = [];
            this._selectedIndex = -1;
            this._resultsBox.destroy_all_children();
            this._resultsScroll.hide();
            this._divider.hide();
            this._reposition();
        }
    }

    _runSearch(text) {
        // A layout change can call this while a text-changed idle is still
        // pending; cancel it so the same query is not searched twice.
        if (this._searchIdleId) {
            GLib.source_remove(this._searchIdleId);
            this._searchIdleId = 0;
        }

        const token = ++this._searchToken;
        this._cancelFileSearch();

        const maxResults = maxResultsFor(this._settings);
        const allResults = runSearch(text, this._settings);
        const webResults = allResults.filter(r => r.type === 'web');
        const localResults = allResults.filter(r => r.type !== 'web');

        // calculator results are complete answers and one-character queries
        // match too broadly for a home-directory walk to be useful; in both
        // cases skip the scan instead of doing wasted I/O on every keystroke
        const query = text.trim();
        const hasCalculator = localResults.some(r => r.type === 'calculator');
        const willSearchFiles = !hasCalculator && query.length >= 2;

        // show the web fallback immediately. it is what makes a query with no
        // local match useful and prevents the "No Results" flash that happened
        // while the much slower filesystem scan was still running.
        this._fileSearchPending = willSearchFiles;
        this._results = [...localResults, ...webResults];
        this._renderResults();

        if (!willSearchFiles)
            return;

        // debounce the scan so a burst of keystrokes only costs one traversal
        this._fileSearchTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, FILE_SEARCH_DELAY_MS, () => {
                this._fileSearchTimeoutId = 0;
                if (token !== this._searchToken)
                    return GLib.SOURCE_REMOVE;

                let done = false;
                const handle = searchFiles(query, maxResults, (files) => {
                    done = true;
                    if (token !== this._searchToken)
                        return;
                    this._fileSearchPending = false;
                    this._fileSearch = null;
                    // a file hit outranks the generic web fallback, so only
                    // keep web when the filesystem search came back empty
                    this._results = files.length > 0
                        ? [...localResults, ...files]
                        : [...localResults, ...webResults];
                    this._renderResults();
                });

                // searchFiles calls back synchronously when none of the
                // standard home directories exist; never keep a stale handle
                this._fileSearch = done ? null : handle;
                return GLib.SOURCE_REMOVE;
            });
    }

    _renderResults() {
        this._resultsBox.destroy_all_children();

        // swap the layout class before any viewport math so the grid padding
        // is part of the measured box
        const gridClass = 'spotlight-results-grid';
        if (this._isGridMode())
            this._resultsScroll.add_style_class_name(gridClass);
        else
            this._resultsScroll.remove_style_class_name(gridClass);

        if (this._results.length === 0) {
            this._selectedIndex = -1;
            this._resultsScroll.set_style('');

            // a filesystem scan is still running: keep the empty state hidden
            // instead of claiming there are no results before it finishes
            if (this._fileSearchPending) {
                this._resultsScroll.hide();
                this._divider.hide();
                this._reposition();
                return;
            }

            this._resultsBox.add_child(buildNoResults(this._entry.get_text().trim()));
            this._resetScroll();
        } else if (this._isGridMode()) {
            this._renderResultsGrid();
            this._updateResultsViewport();
            this._resetScroll();
        } else {
            let rowIndex = 0;
            for (const result of this._results) {
                this._resultsBox.add_child(
                    buildResultRow(result, rowIndex,
                        (r) => { r.activate(); this.close(); }
                    )
                );
                rowIndex++;
            }
            this._applySelection(0, true);
            this._updateResultsViewport();
            this._resetScroll();
        }

        this._resultsScroll.show();
        this._divider.show();
        this._reposition();
    }

    // Sizes the scroll viewport to exactly N whole rows. Doing it here instead
    // of with a fixed max-height in CSS keeps grid tiles and list rows aligned
    // even when the font scale, the popup width, or the monitor height changes.
    _updateResultsViewport() {
        const children = this._resultsBox.get_children();
        if (children.length === 0)
            return;

        let height;
        if (this._isGridMode()) {
            const monitor = Main.layoutManager.primaryMonitor;
            this._visibleGridRows = monitor
                ? visibleGridRows(monitor.height, CHROME_HEIGHT_ESTIMATE)
                : GRID.MAX_VISIBLE_ROWS;
            const rows = Math.min(this._visibleGridRows, children.length);
            height = gridViewportHeight(rows);
        } else {
            const width = Math.max(1, this.width - 16);
            height = LIST_PADDING_TOP + LIST_PADDING_BOTTOM;
            for (const row of children.slice(0, LIST_VISIBLE_ROWS)) {
                const [, natural] = row.get_preferred_height(width);
                height += Math.max(natural, LIST_ROW_MIN_HEIGHT) +
                    LIST_ROW_MARGIN * 2;
            }
        }

        this._resultsScroll.set_style(`max-height: ${Math.ceil(height)}px;`);
    }

    // Renders results as rows of icon tiles, launchpad style. The column count
    // and tile width come from the grid geometry module, so a full row always
    // fits inside the card, including the scrollbar reservation. A partial
    // last row is centered.
    _renderResultsGrid() {
        const {columns, tileWidth} = this._gridMetrics();
        this._gridColumns = columns;

        let rowBox = null;
        for (let i = 0; i < this._results.length; i++) {
            if (i % columns === 0) {
                rowBox = new St.BoxLayout({
                    vertical: false,
                    style_class: 'spotlight-grid-row',
                    x_align: Clutter.ActorAlign.CENTER,
                });
                // StBoxLayout has no spacing constructor property in GNOME
                // Shell 50; the CSS spacing property is the supported path.
                rowBox.set_style(
                    `spacing: ${GRID.GAP}px; margin: ${GRID.ROW_MARGIN}px 0;`);
                this._resultsBox.add_child(rowBox);
            }
            const tile = buildResultTile(this._results[i], i,
                (r) => { r.activate(); this.close(); }
            );
            tile.width = tileWidth;
            tile.height = GRID.TILE_HEIGHT;
            rowBox.add_child(tile);
        }
        this._applySelection(0, true);
    }

    // Applies the selection style and scrolls the row into view unless
    // skipScroll is set. skipScroll is used right after a fresh render, where
    // rows have not been through a layout pass yet; the scroll position is
    // reset to the top in that case.
    _applySelection(index, skipScroll = false) {
        if (this._selectedIndex >= 0 && this._selectedIndex < this._results.length) {
            const oldRow = this._getResultRow(this._selectedIndex);
            if (oldRow)
                oldRow.remove_style_class_name('spotlight-selected');
        }

        this._selectedIndex = index;

        if (index >= 0 && index < this._results.length) {
            const newRow = this._getResultRow(index);
            if (newRow) {
                newRow.add_style_class_name('spotlight-selected');
                if (!skipScroll)
                    this._scrollRowIntoView(newRow);
            }
        }
    }

    // Clears any scroll offset left over from the previous result set, so a
    // new search always starts at the first row.
    _resetScroll() {
        const adjustment = this._resultsScroll.vadjustment;
        if (adjustment)
            adjustment.value = 0;
    }

    _scrollRowIntoView(row) {
        // In grid mode tiles are nested inside row strips; scroll the strip.
        let target = row;
        const parent = row.get_parent();
        if (parent && parent.get_parent() === this._resultsBox)
            target = parent;

        const adjustment = this._resultsScroll.vadjustment;
        if (!adjustment)
            return;

        const box = target.get_allocation_box();
        const rowY = box.y1;
        const rowHeight = box.get_height();
        if (rowHeight <= 0)
            return;

        if (rowY < adjustment.value) {
            adjustment.value = rowY;
        } else if (adjustment.page_size > 0 &&
                   rowY + rowHeight > adjustment.value + adjustment.page_size) {
            adjustment.value = rowY + rowHeight - adjustment.page_size;
        }
    }

    _getResultRow(resultIndex) {
        // list mode: rows are direct children; grid mode: tiles live inside
        // horizontal row strips, so search one level deeper as well
        for (const child of this._resultsBox.get_children()) {
            if (child._resultIndex === resultIndex)
                return child;
            for (const grand of child.get_children()) {
                if (grand._resultIndex === resultIndex)
                    return grand;
            }
        }
        return null;
    }

    _moveSelection(delta) {
        if (this._results.length === 0)
            return;
        let newIndex = this._selectedIndex + delta;
        if (newIndex < 0)
            newIndex = this._results.length - 1;
        if (newIndex >= this._results.length)
            newIndex = 0;
        this._applySelection(newIndex);
    }

    _selectIndex(index) {
        if (this._results.length === 0)
            return;
        const clamped = Math.max(0, Math.min(this._results.length - 1, index));
        this._applySelection(clamped);
    }

    _moveSelectionPage(delta) {
        if (this._results.length === 0)
            return;
        const step = this._isGridMode()
            ? this._gridColumns * this._visibleGridRows
            : LIST_VISIBLE_ROWS;
        // PageUp/PageDown move by a whole page and stop at the ends, while
        // the arrow keys keep their wrap-around behavior.
        this._selectIndex(this._selectedIndex + delta * step);
    }

    _onKeyPress(_, event) {
        // never steal keys while an input method is composing (fcitx5, ibus
        // pinyin, ...). the IME needs arrows to pick candidates, Enter to
        // commit, Escape to cancel and Tab to move between candidates.
        if (this._entry.clutter_text.has_preedit())
            return Clutter.EVENT_PROPAGATE;

        switch (event.get_key_symbol()) {
        case Clutter.KEY_Escape:
            this.close();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
            this._moveSelection(this._isGridMode() ? this._gridColumns : 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            this._moveSelection(this._isGridMode() ? -this._gridColumns : -1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Right:
            if (this._isGridMode()) {
                this._moveSelection(1);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        case Clutter.KEY_Left:
            if (this._isGridMode()) {
                this._moveSelection(-1);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        case Clutter.KEY_Page_Down:
            this._moveSelectionPage(1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Up:
            this._moveSelectionPage(-1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Tab:
        case Clutter.KEY_ISO_Left_Tab:
            // keep tab inside the popup: only the entry is focusable, so a
            // normal tab would walk focus away from the search field and make
            // the keyboard shortcuts stop working
            this._moveSelection(
                event.get_state() & Clutter.ModifierType.SHIFT_MASK ? -1 : 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
            if (this._selectedIndex >= 0 && this._selectedIndex < this._results.length) {
                this._results[this._selectedIndex].activate();
                this.close();
            } else if (this._results.length > 0) {
                this._results[0].activate();
                this.close();
            }
            return Clutter.EVENT_STOP;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    // overridden so that disable() -> destroy() tears down everything cleanly:
    // pops the modal grab, removes idle sources, disconnects the allocation
    // tracker, removes us from the chrome layer, then chains up to the parent
    destroy() {
        this.close();
        this._cancelFileSearch();
        if (this._searchIdleId) {
            GLib.source_remove(this._searchIdleId);
            this._searchIdleId = 0;
        }
        if (this._allocationChangedId) {
            this.disconnect(this._allocationChangedId);
            this._allocationChangedId = 0;
        }
        Main.layoutManager.removeChrome(this);
        this._results = [];
        this._settings.disconnectObject(this);
        this._settings = null;
        super.destroy();
    }
});
