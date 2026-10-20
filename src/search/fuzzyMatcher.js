// lumen launch - fuzzy string matcher
// SPDX-License-Identifier: GPL-3.0-or-later

// Fuzzy matching with scoring. Lower is better; -1 means no match.
//
// Scores are grouped into bands so a real substring can never lose to a
// scattered letter match:
//   0            exact match
//   1            prefix match
//   20..199      match starting on a word boundary
//   200..399     substring match anywhere
//   400+         scattered characters in order
// The old implementation returned 0 for every substring and a negative score
// for scattered matches, so a short scattered match could outrank a direct
// substring match.
export function fuzzyScore(query, target) {
    if (!query || !target)
        return -1;

    query = query.toLowerCase();
    target = target.toLowerCase();

    if (target === query)
        return 0;

    const index = target.indexOf(query);
    if (index === 0)
        return 1;
    if (index > 0) {
        const previous = target[index - 1];
        // Cap the position bonus so a very long file name can never push a
        // boundary or substring match into the scattered-match band.
        if (/[\s\-_./]/.test(previous))
            return 20 + Math.min(index, 179);
        return 200 + Math.min(index, 199);
    }

    let qi = 0;
    let lastMatch = -2;
    let consecutive = 0;
    let boundaries = 0;

    for (let ti = 0; ti < target.length && qi < query.length; ti++) {
        if (target[ti] !== query[qi])
            continue;

        if (ti === lastMatch + 1)
            consecutive++;
        if (ti === 0 || /[\s\-_./]/.test(target[ti - 1]))
            boundaries++;

        lastMatch = ti;
        qi++;
    }

    if (qi < query.length)
        return -1;

    // Base is above the whole substring band (max 100 + target length);
    // shorter targets and tighter matches score better inside the band.
    const score = 1000 + (target.length - query.length) -
        consecutive * 4 - boundaries * 3;
    return Math.max(score, 400);
}
