// spotlight - appearance preferences page
// SPDX-License-Identifier: GPL-3.0-or-later

import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export function buildAppearancePage(settings) {
    const group = new Adw.PreferencesGroup({
        title: _('Appearance'),
    });

    const THEMES = [
        {id: 'dark', label: 'Dark'},
        {id: 'light', label: 'Light'},
        {id: 'nord', label: 'Nord'},
        {id: 'dracula', label: 'Dracula'},
        {id: 'one-dark', label: 'One Dark'},
        {id: 'solarized-light', label: 'Solarized Light'},
    ];

    const themeModel = new Gtk.StringList();
    for (const theme of THEMES)
        themeModel.append(theme.label);

    const themeRow = new Adw.ComboRow({
        title: _('Theme'),
        subtitle: _('Color scheme of the popup'),
        model: themeModel,
    });

    const currentTheme = settings.get_string('theme');
    const currentIndex = THEMES.findIndex(t => t.id === currentTheme);
    if (currentIndex >= 0)
        themeRow.selected = currentIndex;

    themeRow.connect('notify::selected', () => {
        const theme = THEMES[themeRow.selected];
        if (theme)
            settings.set_string('theme', theme.id);
    });
    group.add(themeRow);

    const LAYOUTS = [
        {id: 'list', label: _('List')},
        {id: 'grid', label: _('Grid')},
    ];

    // per-category result cap choices; 0 means "All" (every match).
    // grid offers multiples of 20 (5 columns x 4 visible rows) so each cap
    // is a full page of tiles, list offers the classic small caps
    const MAX_CHOICES_LIST = [0, 5, 10, 15, 20];
    const MAX_CHOICES_GRID = [0, 20, 40, 60, 80, 100];
    const maxLabel = v => (v === 0 ? _('All') : `${v}`);

    const layoutModel = new Gtk.StringList();
    for (const layout of LAYOUTS)
        layoutModel.append(layout.label);

    const layoutRow = new Adw.ComboRow({
        title: _('Results layout'),
        subtitle: _('List rows or an icon grid (Launchpad style)'),
        model: layoutModel,
    });

    const currentLayout = settings.get_string('layout-mode');
    const layoutIndex = LAYOUTS.findIndex(l => l.id === currentLayout);
    if (layoutIndex >= 0)
        layoutRow.selected = layoutIndex;

    const maxResultsRow = new Adw.ComboRow({
        title: _('Max results per category'),
        subtitle: _('How many results each category shows'),
    });

    // swapping the model resets `selected`, which would fire the write-back
    // handler; guard so a layout switch never clobbers the stored value
    let syncingMaxChoices = false;

    function applyMaxChoices(layoutId) {
        const choices = layoutId === 'grid' ? MAX_CHOICES_GRID : MAX_CHOICES_LIST;
        const model = new Gtk.StringList();
        for (const v of choices)
            model.append(maxLabel(v));

        syncingMaxChoices = true;
        maxResultsRow.model = model;
        maxResultsRow._choices = choices;

        const stored = settings.get_int('max-results');
        let idx = choices.indexOf(stored);
        if (idx < 0) {
            // stored value not offered in this layout (e.g. 10 -> grid):
            // snap to the closest offered cap (rounding up to the next
            // full page when possible) and write it back, so the UI never
            // displays a different limit than the one actually in effect
            idx = choices.length - 1;
            for (let i = 0; i < choices.length; i++) {
                if (choices[i] >= stored) {
                    idx = i;
                    break;
                }
            }
            settings.set_int('max-results', choices[idx]);
        }
        maxResultsRow.selected = idx;
        syncingMaxChoices = false;
    }

    applyMaxChoices(layoutIndex >= 0 ? LAYOUTS[layoutIndex].id : 'list');

    layoutRow.connect('notify::selected', () => {
        const layout = LAYOUTS[layoutRow.selected];
        if (!layout)
            return;
        settings.set_string('layout-mode', layout.id);
        applyMaxChoices(layout.id);
    });
    group.add(layoutRow);

    maxResultsRow.connect('notify::selected', () => {
        if (syncingMaxChoices)
            return;
        const value = maxResultsRow._choices[maxResultsRow.selected];
        if (value !== undefined)
            settings.set_int('max-results', value);
    });
    group.add(maxResultsRow);

    const widthRow = new Adw.SpinRow({
        title: _('Popup width'),
        subtitle: _('Width in pixels'),
        adjustment: new Gtk.Adjustment({
            lower: 400,
            upper: 1200,
            step_increment: 20,
            page_increment: 100,
            value: settings.get_int('popup-width'),
        }),
    });
    settings.bind('popup-width', widthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    group.add(widthRow);

    return group;
}
