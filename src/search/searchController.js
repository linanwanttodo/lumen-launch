// spotlight - search controller
// SPDX-License-Identifier: GPL-3.0-or-later

import {searchApps} from './appSearch.js';
import {searchCalculator} from './calculatorSearch.js';
import {searchSystemActions} from './systemActionsSearch.js';
import {searchSettings} from './settingsSearch.js';
import {searchWeb} from './webSearch.js';

// practical ceiling used when the setting is 0 ("All"): every realistic
// match is shown, and a runaway query still can't build millions of widgets
export const MAX_RESULTS_ALL = 1000;

// resolves the max-results setting: 0 (the "All" choice in prefs) means
// show every match, scrollable; any other value caps each category
export function maxResultsFor(settings) {
    const n = settings.get_int('max-results');
    return n > 0 ? n : MAX_RESULTS_ALL;
}

// orchestrates all search providers and combines results in priority order
// priority: apps first then calculator then system actions then settings then web last
export function runSearch(text, settings) {
    const trimmed = text.trim();
    const maxResults = maxResultsFor(settings);
    const allResults = [];

    allResults.push(...searchApps(trimmed, maxResults));

    const calcResult = searchCalculator(trimmed);
    if (calcResult)
        allResults.push(calcResult);

    allResults.push(...searchSystemActions(trimmed));
    allResults.push(...searchSettings(trimmed));

    if (allResults.length === 0 && settings.get_boolean('show-web-search')) {
        const engine = settings.get_string('web-search-engine');
        allResults.push(searchWeb(trimmed, engine));
    }

    return allResults;
}
