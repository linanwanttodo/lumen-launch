// lumen launch - no results widget
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// Creates the empty state widget shown when a search returns nothing.
// Both labels expand and center so the message stays centered at every
// popup width instead of hugging the left edge.
export function buildNoResults(query) {
    const box = new St.BoxLayout({
        vertical: true,
        style_class: 'spotlight-no-results',
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
    });

    const title = new St.Label({
        style_class: 'spotlight-no-results-title',
        text: _('No Results'),
        x_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
    });
    title.clutter_text.x_align = Clutter.ActorAlign.CENTER;

    const detail = new St.Label({
        text: _('No results for "%s"').format(query),
        x_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
    });
    // A long query must not stretch the fixed-width card.
    detail.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    detail.clutter_text.single_line_mode = true;
    detail.clutter_text.x_align = Clutter.ActorAlign.CENTER;

    box.add_child(title);
    box.add_child(detail);
    return box;
}
