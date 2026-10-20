// lumen launch - grid result tile widget
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

// Builds one tile in the icon grid: a large icon above a single-line label.
// The popup assigns width and height from its grid metrics; the label must
// ellipsize instead of stretching the column and pushing the last tile out
// of the card. The icon expands vertically so the icon and label stay
// optically centered at any font scale.
// Tiles are not focusable: keyboard focus stays in the search entry and the
// popup routes arrow/tab keys to the selection.
export function buildResultTile(result, resultIndex, onActivate) {
    const tile = new St.BoxLayout({
        style_class: 'spotlight-result spotlight-result-tile',
        vertical: true,
        reactive: true,
        can_focus: false,
        x_align: Clutter.ActorAlign.CENTER,
    });

    const iconParams = {
        fallback_icon_name: 'application-x-executable',
        style_class: 'spotlight-tile-icon',
        icon_size: 48,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        // let the icon absorb the free vertical space and center itself
        y_expand: true,
    };

    if (result.type === 'app' && result.app)
        iconParams.gicon = result.app.get_icon();
    else if (typeof result.icon === 'string')
        iconParams.icon_name = result.icon;
    else
        iconParams.gicon = result.icon;

    tile.add_child(new St.Icon(iconParams));

    const label = new St.Label({
        style_class: 'spotlight-tile-label',
        text: result.gridTitle ?? result.title,
        x_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
    });
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    label.clutter_text.single_line_mode = true;
    label.clutter_text.line_wrap = false;
    label.clutter_text.x_align = Clutter.ActorAlign.CENTER;
    tile.add_child(label);

    tile._resultIndex = resultIndex;

    tile.connectObject(
        'button-release-event', (_, event) => {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            onActivate(result);
            return Clutter.EVENT_STOP;
        },
        tile,
    );

    return tile;
}
