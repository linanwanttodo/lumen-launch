// lumen launch - about preferences page
// SPDX-License-Identifier: GPL-3.0-or-later

import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export function buildAboutPage() {
    const group = new Adw.PreferencesGroup({title: _('About')});
    group.add(new Adw.ActionRow({
        title: 'Lumen launch',
        subtitle: _('A compact macOS Spotlight inspired launcher for GNOME Shell.'),
    }));

    const repoRow = new Adw.ActionRow({title: _('GitHub repository')});
    const repoButton = new Gtk.LinkButton({
        uri: 'https://github.com/linanwanttodo/lumen-launch',
        label: 'linanwanttodo/lumen-launch',
        halign: Gtk.Align.END,
    });
    repoRow.add_suffix(repoButton);
    group.add(repoRow);

    return group;
}
