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

    const maxResultsRow = new Adw.SpinRow({
        title: _('Max results per category'),
        adjustment: new Gtk.Adjustment({
            lower: 1,
            upper: 20,
            step_increment: 1,
            page_increment: 5,
            value: settings.get_int('max-results'),
        }),
    });
    settings.bind('max-results', maxResultsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    group.add(maxResultsRow);

    return group;
}
