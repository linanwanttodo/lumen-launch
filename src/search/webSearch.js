// spotlight - web search provider
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const SEARCH_ENGINES = {
    google: 'https://www.google.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
    brave: 'https://search.brave.com/search?q=',
    bing: 'https://www.bing.com/search?q=',
    startpage: 'https://www.startpage.com/do/search?q=',
};

const ENGINE_LABELS = {
    google: 'Google',
    duckduckgo: 'DuckDuckGo',
    brave: 'Brave',
    bing: 'Bing',
    startpage: 'Startpage',
};

// returns a web search result for the given query
// only called when no local results matched
export function searchWeb(query, engineName) {
    const urlTemplate = SEARCH_ENGINES[engineName] || SEARCH_ENGINES.google;
    const label = ENGINE_LABELS[engineName] || 'Google';
    return {
        type: 'web',
        title: _('Search the web for "%s"').format(query),
        // the grid shows only one line, so use the query itself instead of
        // the long sentence and let the web icon carry the meaning
        gridTitle: query,
        description: _('Open %s in your browser').format(label),
        icon: 'web-browser-symbolic',
        activate: () => {
            Gio.app_info_launch_default_for_uri(
                urlTemplate + encodeURIComponent(query), null);
        },
    };
}
