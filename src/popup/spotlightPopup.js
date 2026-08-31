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
import {runSearch, maxResultsFor} from '../search/searchController.js';
import {getAllApps} from '../search/appSearch.js';
import {searchFiles} from '../search/fileSearch.js';

// the popup widget - a vertical box with a search entry and scrollable results
// added to gnome's chrome layer so it floats above all windows
// uses a modal grab to capture all keyboard input while open
const GRID_COLUMNS = 5;
const GRID_MIN_WIDTH = 820;
const GRID_TILE_GAP = 24;

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
        this._grab = null;
        this._allocationChangedId = 0;
        this._stagePressId = 0;
        this._themeClass = '';

        // the frosted theme was removed; migrate any stored value so the
        // card never ends up with an unstyled (transparent) theme class
        if (this._settings.get_string('theme') === 'frosted')
            this._settings.set_string('theme', 'dark');

        this._settings.connectObject(
            'changed::theme', this._updateTheme.bind(this),
            'changed::layout-mode', this._onLayoutModeChanged.bind(this),
            'changed::popup-width', this._applyWidth.bind(this),
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

    // grid tiles need more horizontal room than list rows, so clamp the
    // popup to a comfortable minimum width while grid mode is active
    _applyWidth() {
        const width = this._settings.get_int('popup-width');
        this.width = this._isGridMode() ? Math.max(width, GRID_MIN_WIDTH) : width;
        this._reposition();
    }

    _onLayoutModeChanged() {
        this._applyWidth();
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
        // during early init (before addChrome) there is no monitor yet
        if (!monitor)
            return;
        // use the ACTUAL width (grid mode clamps it up from popup-width),
        // otherwise the x centering is computed for the wrong width and the
        // popup sits offset to the left
        const popupWidth = this.width > 0 ? this.width : this._settings.get_int('popup-width');
        // prefer the real allocation height (respects max-height, so the popup
        // centers as a "search box + 5 rows" unit); fall back to the natural
        // height before the actor has been laid out
        const [, naturalHeight] = this.get_preferred_height(popupWidth);
        const allocHeight = this.get_allocation_box().get_height();
        const height = allocHeight > 0 ? allocHeight : naturalHeight;
        this.set_position(
            Math.floor(monitor.x + (monitor.width - popupWidth) / 2),
            Math.floor(monitor.y + (monitor.height - height) / 2),
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

        if (this._grab) {
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

        this._entry.set_text('');
        this._showDefaultResults();
        this._entry.grab_key_focus();
    }

    close() {
        if (!this.visible)
            return;

        this._searchToken++;
        if (this._fileSearch) {
            this._fileSearch.cancel();
            this._fileSearch = null;
        }

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

    // default view with an empty search box: every installed app, most-used
    // first (launchpad style in grid mode, a full app list in list mode).
    // the max-results setting only caps SEARCH results, not this view
    _showDefaultResults() {
        this._searchToken++;
        if (this._fileSearch) {
            this._fileSearch.cancel();
            this._fileSearch = null;
        }

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
        const token = ++this._searchToken;
        if (this._fileSearch) {
            this._fileSearch.cancel();
            this._fileSearch = null;
        }

        const maxResults = maxResultsFor(this._settings);
        const allResults = runSearch(text, this._settings);
        const webResults = allResults.filter(r => r.type === 'web');
        const localResults = allResults.filter(r => r.type !== 'web');
        this._results = localResults;
        this._renderResults();

        // files are searched asynchronously so the shell never blocks;
        // merge them in once ready (dropping the web fallback if files matched)
        this._fileSearch = searchFiles(text.trim(), maxResults, (files) => {
            if (token !== this._searchToken)
                return;
            this._fileSearch = null;
            if (files.length > 0)
                this._results = [...localResults, ...files];
            else
                this._results = [...localResults, ...webResults];
            this._renderResults();
        });
    }

    _renderResults() {
        this._resultsBox.destroy_all_children();

        if (this._results.length === 0) {
            this._resultsBox.add_child(buildNoResults(this._entry.get_text().trim()));
        } else if (this._isGridMode()) {
            this._renderResultsGrid();
        } else {
            let rowIndex = 0;
            for (const result of this._results) {
                this._resultsBox.add_child(
                    buildResultRow(result, rowIndex,
                        (r) => { r.activate(); this.close(); },
                        (idx) => { this._applySelection(idx); }
                    )
                );
                rowIndex++;
            }
            this._applySelection(0, true);
        }

        // the grid shows 4 rows of tiles before scrolling, the list 5 rows;
        // switching the class swaps the max-height in css
        const gridClass = 'spotlight-results-grid';
        if (this._isGridMode())
            this._resultsScroll.add_style_class_name(gridClass);
        else
            this._resultsScroll.remove_style_class_name(gridClass);

        this._resultsScroll.show();
        this._divider.show();
        this._reposition();
    }

    // renders results as rows of icon tiles (GRID_COLUMNS per row),
    // launchpad style
    _renderResultsGrid() {
        // every tile gets a HARD fixed width (Clutter fixed size, not css
        // min-width which long labels could stretch), so columns line up,
        // labels ellipsize inside, and nothing ever overflows the last
        // column. tiles are spaced GRID_TILE_GAP apart so hover highlights
        // never bleed onto neighbours.
        // horizontal room = card width - card padding (8px each side) -
        // results area padding (8px each side, see stylesheet)
        const available = this.width - 32;
        const tileWidth = Math.floor(
            (available - GRID_TILE_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
        let rowBox = null;
        for (let i = 0; i < this._results.length; i++) {
            if (i % GRID_COLUMNS === 0) {
                rowBox = new St.BoxLayout({
                    vertical: false,
                    style_class: 'spotlight-grid-row',
                });
                this._resultsBox.add_child(rowBox);
            }
            const tile = buildResultTile(this._results[i], i,
                (r) => { r.activate(); this.close(); },
                (idx) => { this._applySelection(idx); }
            );
            tile.width = tileWidth;
            rowBox.add_child(tile);
        }
        this._applySelection(0, true);
    }

    // applies the selection style, and scrolls the row into view unless
    // skipScroll is set - used right after a fresh render where rows have
    // not been through a layout pass yet, so they have no allocation box
    // to scroll to (and none is needed, since a freshly rendered list is
    // already scrolled to the top where row 0 lives)
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

    _scrollRowIntoView(row) {
        // in grid mode tiles are nested inside row strips; scroll the strip
        let target = row;
        const parent = row.get_parent();
        if (parent && parent.get_parent() === this._resultsBox)
            target = parent;
        const adjustment = this._resultsScroll.vadjustment;
        const rowY = target.get_allocation_box().y1;
        const rowHeight = target.get_allocation_box().get_height();
        if (rowY < adjustment.value)
            adjustment.value = rowY;
        else if (rowY + rowHeight > adjustment.value + adjustment.page_size)
            adjustment.value = rowY + rowHeight - adjustment.page_size;
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

    _onKeyPress(_, event) {
        switch (event.get_key_symbol()) {
        case Clutter.KEY_Escape:
            this.close();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
            this._moveSelection(this._isGridMode() ? GRID_COLUMNS : 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            this._moveSelection(this._isGridMode() ? -GRID_COLUMNS : -1);
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
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
            // if an input method (e.g. fcitx pinyin) is composing text,
            // let Enter through so the IME can commit the candidate
            // instead of activating the first result
            if (this._entry.clutter_text.has_preedit())
                return Clutter.EVENT_PROPAGATE;

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
        if (this._allocationChangedId) {
            this.disconnect(this._allocationChangedId);
            this._allocationChangedId = 0;
        }
        Main.layoutManager.removeChrome(this);
        this._results = [];
        this._settings = null;
        super.destroy();
    }
});
