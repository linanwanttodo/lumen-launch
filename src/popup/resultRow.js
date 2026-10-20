// spotlight - result row widget
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

// builds a single result row with icon, title, optional description and
// click handling. rows are NOT focusable: the search entry owns the keyboard
// focus for the whole lifetime of the popup, and tab/arrow keys are routed
// through the popup itself. making rows focusable used to let Tab move focus
// away from the entry, after which typing and Escape stopped working.
// the extra spotlight-result-row class carries the row's inset margins and
// fixed height (grid tiles reuse .spotlight-result for their selection colors
// and must not inherit the row geometry).
export function buildResultRow(result, resultIndex, onActivate) {
    const hbox = new St.BoxLayout({
        style_class: 'spotlight-result spotlight-result-row',
        vertical: false,
        reactive: true,
        can_focus: false,
        x_expand: true,
    });

    const iconParams = {
        fallback_icon_name: 'application-x-executable',
        style_class: 'spotlight-result-icon',
        icon_size: 28,
    };

    if (result.type === 'app' && result.app)
        iconParams.gicon = result.app.get_icon();
    else if (typeof result.icon === 'string')
        iconParams.icon_name = result.icon;
    else
        iconParams.gicon = result.icon;

    const icon = new St.Icon(iconParams);

    const text = new St.BoxLayout({
        style_class: 'spotlight-result-content',
        vertical: true,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });

    const title = new St.Label({
        style_class: 'spotlight-result-title',
        text: result.title,
        x_expand: true,
    });
    title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    title.clutter_text.single_line_mode = true;
    text.add_child(title);

    if (result.description) {
        const description = new St.Label({
            style_class: 'spotlight-result-description',
            text: result.description,
            x_expand: true,
        });
        description.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        description.clutter_text.single_line_mode = true;
        text.add_child(description);
    }

    hbox.add_child(icon);
    hbox.add_child(text);

    hbox._resultIndex = resultIndex;

    hbox.connectObject(
        'button-release-event', (_, event) => {
            // only the primary button activates; right/middle clicks should
            // not launch whatever happens to be under the pointer
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            onActivate(result);
            return Clutter.EVENT_STOP;
        },
        hbox,
    );

    return hbox;
}
