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
import {buildNoResults} from './noResults.js';
import {runSearch} from './searchController.js';
import {getMostUsedApps} from './appSearch.js';
import {searchFiles} from './fileSearch.js';

// the popup widget - a vertical box with a search entry and scrollable results
// added to gnome's chrome layer so it floats above all windows
// uses a modal grab to capture all keyboard input while open
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

        this._settings.connectObject(
            'changed::theme', this._updateTheme.bind(this),
            this,
        );
        this._updateTheme();

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

        this.add_child(this._entryBox);
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
    _updateTheme() {
        if (this._themeClass)
            this.remove_style_class_name(this._themeClass);
        this._themeClass = `spotlight-theme-${this._settings.get_string('theme')}`;
        this.add_style_class_name(this._themeClass);
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
        const popupWidth = this._settings.get_int('popup-width');
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
        this._showMostUsedApps();
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
            this._showMostUsedApps();
            return;
        }

        this._searchIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._searchIdleId = 0;
            this._runSearch(text);
            return GLib.SOURCE_REMOVE;
        });
    }

    _showMostUsedApps() {
        this._searchToken++;
        if (this._fileSearch) {
            this._fileSearch.cancel();
            this._fileSearch = null;
        }

        const limit = Math.max(6, this._settings.get_int('max-results') * 2);
        this._results = getMostUsedApps(limit);

        if (this._results.length > 0) {
            this._renderResults();
        } else {
            this._results = [];
            this._selectedIndex = -1;
            this._resultsBox.destroy_all_children();
            this._resultsScroll.hide();
            this._reposition();
        }
    }

    _runSearch(text) {
        const token = ++this._searchToken;
        if (this._fileSearch) {
            this._fileSearch.cancel();
            this._fileSearch = null;
        }

        const maxResults = this._settings.get_int('max-results');
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

        this._resultsScroll.show();
        this._reposition();
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
        const adjustment = this._resultsScroll.vadjustment;
        const rowY = row.get_allocation_box().y1;
        const rowHeight = row.get_allocation_box().get_height();
        if (rowY < adjustment.value)
            adjustment.value = rowY;
        else if (rowY + rowHeight > adjustment.value + adjustment.page_size)
            adjustment.value = rowY + rowHeight - adjustment.page_size;
    }

    _getResultRow(resultIndex) {
        for (const child of this._resultsBox.get_children()) {
            if (child._resultIndex === resultIndex)
                return child;
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
            this._moveSelection(1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            this._moveSelection(-1);
            return Clutter.EVENT_STOP;
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
