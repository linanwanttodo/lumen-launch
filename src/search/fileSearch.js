// spotlight - file search provider
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {fuzzyScore} from './fuzzyMatcher.js';

// common user directories to search, relative to $HOME
const SEARCH_DIRS = [
    'Desktop',
    'Documents',
    'Downloads',
    'Pictures',
    'Music',
    'Videos',
    'Templates',
];
const MAX_DEPTH = 4;
const FILES_PER_TICK = 60;

// asynchronously searches the user's directories in batches (idle ticks) so
// the shell never freezes. matches filenames with fuzzy scoring, so Chinese
// names and partial words work. results are ranked by match score so the
// most relevant files/folders come first. returns a {cancel} handle.
export function searchFiles(query, maxResults, callback) {
    const home = GLib.get_home_dir();
    const workQueue = [];
    const results = []; // {score, data}
    let cancelled = false;
    let sourceId = 0;

    function closeIters() {
        for (const w of workQueue) {
            if (w.iter) {
                try {
                    w.iter.close(null);
                } catch (e) {}
            }
        }
        workQueue.length = 0;
    }

    function cancel() {
        cancelled = true;
        if (sourceId) {
            GLib.source_remove(sourceId);
            sourceId = 0;
        }
        closeIters();
    }

    if (!query || query.length === 0) {
        callback([]);
        return {cancel};
    }

    for (const dir of SEARCH_DIRS) {
        const path = `${home}/${dir}`;
        if (GLib.file_test(path, GLib.FileTest.IS_DIR))
            workQueue.push({dir: path, depth: 0, iter: null});
    }

    if (workQueue.length === 0) {
        callback([]);
        return {cancel};
    }

    const finish = () => {
        sourceId = 0;
        closeIters();
        results.sort((a, b) => a.score - b.score);
        callback(results.slice(0, maxResults).map(r => r.data));
    };

    const tick = () => {
        if (cancelled)
            return GLib.SOURCE_REMOVE;

        if (results.length >= maxResults * 3) {
            finish();
            return GLib.SOURCE_REMOVE;
        }

        let item = null;
        while (workQueue.length > 0 && !item) {
            const w = workQueue[0];
            if (!w.iter) {
                try {
                    w.iter = Gio.File.new_for_path(w.dir).enumerate_children(
                        'standard::name,standard::type',
                        Gio.FileQueryInfoFlags.NONE, null);
                } catch (e) {
                    workQueue.shift();
                    continue;
                }
            }
            item = w;
        }

        if (!item) {
            finish();
            return GLib.SOURCE_REMOVE;
        }

        let count = 0;
        let child = null;
        while (count < FILES_PER_TICK) {
            try {
                child = item.iter.next_file(null);
            } catch (e) {
                child = null;
            }
            if (!child)
                break;
            count++;
            const name = child.get_name();
            const type = child.get_file_type();
            const fullPath = `${item.dir}/${name}`;

            if (type === Gio.FileType.DIRECTORY) {
                if (item.depth < MAX_DEPTH && !name.startsWith('.'))
                    workQueue.push({dir: fullPath, depth: item.depth + 1, iter: null});
                if (results.length < maxResults * 3) {
                    const score = fuzzyScore(query, name);
                    if (score >= 0) {
                        results.push({score, data: {
                            type: 'file',
                            title: name,
                            description: _('Folder · %s').format(fullPath.slice(home.length + 1)),
                            path: fullPath,
                            icon: 'folder',
                            activate: () => {
                                Gio.app_info_launch_default_for_uri(
                                    Gio.File.new_for_path(fullPath).get_uri(), null);
                            },
                        }});
                    }
                }
            } else if (type === Gio.FileType.REGULAR && !name.startsWith('.')) {
                const clean = name.replace(/\.[^.]+$/, '');
                // Lower score is better, so keep the better of the two
                // matches; -1 means "no match" and must not win over a
                // real score.
                const nameScore = fuzzyScore(query, name);
                const cleanScore = fuzzyScore(query, clean);
                let score;
                if (nameScore < 0)
                    score = cleanScore;
                else if (cleanScore < 0)
                    score = nameScore;
                else
                    score = Math.min(nameScore, cleanScore);
                if (score < 0 || results.length >= maxResults * 3)
                    continue;
                results.push({score, data: {
                    type: 'file',
                    title: name,
                    description: fullPath.slice(home.length + 1),
                    path: fullPath,
                    icon: fileIcon(name),
                    activate: () => {
                        Gio.app_info_launch_default_for_uri(
                            Gio.File.new_for_path(fullPath).get_uri(), null);
                    },
                }});
            }
        }

        if (!child) {
            try {
                item.iter.close(null);
            } catch (e) {}
            workQueue.shift();
        }

        return GLib.SOURCE_CONTINUE;
    };

    sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, tick);
    return {cancel};
}

function fileIcon(name) {
    try {
        const [contentType] = Gio.content_type_guess(name, null);
        return Gio.content_type_get_icon(contentType);
    } catch (e) {
        return 'text-x-generic';
    }
}
