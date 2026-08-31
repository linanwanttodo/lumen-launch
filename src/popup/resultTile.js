// spotlight - grid result tile widget
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Clutter from 'gi://Clutter';

// builds a single grid tile: large icon on top, label underneath,
// like the macOS Launchpad / KDE fullscreen app grid.
// reuses the "spotlight-result" style class so the per-theme hover and
// selection colors from stylesheet.css apply to tiles as well.
export function buildResultTile(result, resultIndex, onActivate, onHover) {
    const tile = new St.BoxLayout({
        style_class: 'spotlight-result spotlight-result-tile',
        vertical: true,
        reactive: true,
        can_focus: true,
        track_hover: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
    });

    const iconParams = {
        fallback_icon_name: 'application-x-executable',
        style_class: 'spotlight-tile-icon',
        icon_size: 48,
        x_align: Clutter.ActorAlign.CENTER,
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
        text: result.title,
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    label.clutter_text.ellipsize = 2; // PANGO_ELLIPSIZE_END
    label.clutter_text.x_align = Clutter.ActorAlign.CENTER;
    tile.add_child(label);

    tile._resultIndex = resultIndex;

    tile.connectObject(
        'button-release-event', () => {
            onActivate(result);
            return Clutter.EVENT_STOP;
        },
        'enter-event', () => {
            onHover(resultIndex);
            return Clutter.EVENT_PROPAGATE;
        },
        tile,
    );

    return tile;
}
