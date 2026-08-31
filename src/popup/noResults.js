// spotlight - no results widget
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// creates the empty state widget shown when search returns nothing
export function buildNoResults(query) {
    const box = new St.BoxLayout({
        vertical: true,
        style_class: 'spotlight-no-results',
    });
    box.add_child(new St.Label({
        style_class: 'spotlight-no-results-title',
        text: _('No Results'),
    }));
    box.add_child(new St.Label({
        text: _('No results for "%s"').format(query),
    }));
    return box;
}
