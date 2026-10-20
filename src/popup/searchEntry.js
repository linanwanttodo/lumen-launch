// spotlight - search entry widget
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Clutter from 'gi://Clutter';

// builds the search entry box with icon and text field
export function buildSearchEntry() {
    const entryBox = new St.BoxLayout({
        vertical: false,
        x_expand: true,
        style_class: 'spotlight-entry-box',
    });

    const searchIcon = new St.Icon({
        icon_name: 'system-search-symbolic',
        style_class: 'spotlight-search-icon',
        icon_size: 20,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const entry = new St.Entry({
        style_class: 'spotlight-entry',
        can_focus: true,
        x_expand: true,
    });

    // Some shell themes (Yaru does) paint a focus ring on every StEntry with
    // an !important box-shadow. St appends inline properties after the
    // stylesheet cascade, so an inline reset is the only form a theme cannot
    // win against. Keep this in sync with the .spotlight-entry rules in
    // stylesheet.css.
    entry.set_style(
        'background-color: transparent; ' +
        'border: none; ' +
        'box-shadow: none; ' +
        'outline: none;');

    entryBox.add_child(searchIcon);
    entryBox.add_child(entry);

    return {entryBox, entry};
}
