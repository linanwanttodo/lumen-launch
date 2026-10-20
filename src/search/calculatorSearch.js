// lumen launch - calculator search provider
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {evaluateArithmetic, formatNumber} from './calculator.js';

// Returns a calculator result if the input is valid arithmetic.
export function searchCalculator(query) {
    const result = evaluateArithmetic(query);
    if (result === null)
        return null;

    if (!Number.isFinite(result)) {
        return {
            type: 'calculator',
            title: _('Cannot divide by zero'),
            description: _('Check the expression'),
            icon: 'dialog-warning-symbolic',
            activate: () => {},
        };
    }

    return {
        type: 'calculator',
        title: formatNumber(result),
        description: _('Press Enter to copy to clipboard'),
        icon: 'accessories-calculator-symbolic',
        activate: () => {
            // clipboard write only - triggered by explicit user action on the
            // calculator result; declared in metadata.json
            const clipboard = St.Clipboard.get_default();
            clipboard.set_text(St.ClipboardType.CLIPBOARD, formatNumber(result));
        },
    };
}
