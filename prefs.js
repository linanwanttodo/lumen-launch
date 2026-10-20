// spotlight - preferences window
// SPDX-License-Identifier: GPL-3.0-or-later

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';

import {buildShortcutPage} from './src/prefs/shortcutPage.js';
import {buildAppearancePage} from './src/prefs/appearancePage.js';
import {buildWebSearchPage} from './src/prefs/webSearchPage.js';
import {buildAboutPage} from './src/prefs/aboutPage.js';

export default class SpotlightPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Lumen launch',
            icon_name: 'system-search-symbolic',
        });

        page.add(buildShortcutPage(settings));
        page.add(buildAppearancePage(settings));
        page.add(buildWebSearchPage(settings));
        page.add(buildAboutPage());

        window.add(page);
        window.set_search_enabled(true);
    }
}
