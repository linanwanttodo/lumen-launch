// lumen launch - app search provider
// SPDX-License-Identifier: GPL-3.0-or-later

import Shell from 'gi://Shell';
import {fuzzyScore} from './fuzzyMatcher.js';

// Searches installed apps using the shell app system.
// Uses fuzzy matching so ffx matches firefox.
// Groups variants by base name (Firefox, Firefox ESR) and keeps the
// best-scored variant instead of whichever one happens to be enumerated
// first; usage frequency breaks ties.
export function searchApps(query, maxResults) {
    const appSystem = Shell.AppSystem.get_default();
    const allApps = appSystem.get_installed();
    const appUsage = Shell.AppUsage.get_default();
    const bestByName = new Map();

    for (const app of allApps) {
        const name = app.get_name() || '';
        const id = app.get_id() || '';

        const nameScore = fuzzyScore(query, name);
        const idScore = fuzzyScore(query, id.replace('.desktop', ''));

        // -1 means no match - only skip if both scores are -1
        let bestScore;
        if (nameScore < 0 && idScore < 0)
            continue;
        else if (nameScore < 0)
            bestScore = idScore;
        else if (idScore < 0)
            bestScore = nameScore;
        else
            bestScore = Math.min(nameScore, idScore);

        // Strip a known trailing variant suffix (e.g. "Firefox ESR" ->
        // "firefox") rather than splitting on any hyphen, which would also
        // wrongly truncate apps whose real name contains one, like
        // "GNOME-Builder".
        const baseName = name.toLowerCase()
            .replace(/[\s-]+(esr|beta|nightly|dev|canary|stable|preview)$/, '')
            .trim();

        const candidate = {app, appId: id, title: name, score: bestScore};
        const existing = bestByName.get(baseName);
        if (!existing ||
            candidate.score < existing.score ||
            (candidate.score === existing.score &&
             appUsage.compare(candidate.appId, existing.appId) < 0)) {
            bestByName.set(baseName, candidate);
        }
    }

    const scored = [...bestByName.values()];
    scored.sort((a, b) => {
        if (a.score !== b.score)
            return a.score - b.score;
        return appUsage.compare(a.appId, b.appId);
    });

    return scored.slice(0, maxResults).map(({app, appId, title}) => ({
        type: 'app',
        title,
        app,
        appId,
        activate: () => {
            const shellApp = appSystem.lookup_app(app.get_id());
            if (shellApp)
                shellApp.activate();
            else
                app.launch([], null);
        },
    }));
}

// Returns ALL installed apps, most-used first, used for the empty-query
// state in both layouts (launchpad style: the full app grid until you type).
// Groups variants by base name and keeps the most-used variant.
export function getAllApps() {
    const appSystem = Shell.AppSystem.get_default();
    const appUsage = Shell.AppUsage.get_default();
    const bestByName = new Map();

    for (const app of appSystem.get_installed()) {
        const name = app.get_name() || '';
        const baseName = name.toLowerCase()
            .replace(/[\s-]+(esr|beta|nightly|dev|canary|stable|preview)$/, '')
            .trim();

        const existing = bestByName.get(baseName);
        if (!existing || appUsage.compare(app.get_id(), existing.get_id()) < 0)
            bestByName.set(baseName, app);
    }

    const apps = [...bestByName.values()];
    // compare() orders the more-used app first
    apps.sort((a, b) => appUsage.compare(a.get_id(), b.get_id()));

    return apps.map(app => ({
        type: 'app',
        title: app.get_name(),
        app,
        appId: app.get_id(),
        activate: () => {
            const shellApp = appSystem.lookup_app(app.get_id());
            if (shellApp)
                shellApp.activate();
            else
                app.launch([], null);
        },
    }));
}
