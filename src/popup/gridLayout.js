// lumen launch - grid geometry
// SPDX-License-Identifier: GPL-3.0-or-later

// Pure geometry helpers for the icon grid. Keeping the math in a module
// without GI imports makes it testable from plain Node and gives the popup
// and the tile widget a single source of truth for every pixel value.

export const GRID = Object.freeze({
    // outer card padding defined by .spotlight-container
    CONTAINER_PADDING: 8,
    // padding inside the scroll view defined by .spotlight-results-grid
    PADDING_X: 8,
    PADDING_TOP: 4,
    PADDING_BOTTOM: 8,
    // Right-hand gutter reserved for the overlay scrollbar. The bar is drawn
    // on top of the scrolled content (it does not narrow it), so the row is
    // made narrower and centered: this value ends up as an equal gutter on
    // both sides, wide enough to keep the last tile clear of a 4px bar.
    SCROLLBAR_WIDTH: 20,
    // The grid is a fixed 5x4 launchpad layout. The column count never
    // changes with the popup width; the popup is widened to MIN_POPUP_WIDTH
    // in grid mode so a full row of tiles always fits.
    COLUMNS: 5,
    GAP: 24,
    // Width the popup is clamped to in grid mode. With 5 columns, 24px gaps,
    // the paddings above and the scrollbar reserve, this leaves a tile width
    // of 138px, which is the proportion the grid had before it became
    // width adaptive.
    MIN_POPUP_WIDTH: 840,
    TILE_HEIGHT: 96,
    ROW_MARGIN: 4,
    MAX_VISIBLE_ROWS: 4,
});

// Computes the column count and tile width for a popup of the given width.
// The layout is a fixed 5 column grid, so the column count does not depend
// on the width. The tile width is derived from the space that is actually
// available, which keeps a full row inside the card even when the popup is
// narrower than the grid minimum.
export function computeGridMetrics(popupWidth) {
    const available = Math.max(1,
        popupWidth -
        GRID.CONTAINER_PADDING * 2 -
        GRID.PADDING_X * 2 -
        GRID.SCROLLBAR_WIDTH);

    const columns = GRID.COLUMNS;
    const tileWidth = tileWidthFor(available, columns);

    return {available, columns, tileWidth};
}

function tileWidthFor(available, columns) {
    return Math.floor(
        (available - GRID.GAP * (columns - 1)) / columns);
}

// Vertical distance between the top edges of two grid rows, including the
// margin above and below each row.
export function gridRowPitch() {
    return GRID.TILE_HEIGHT + GRID.ROW_MARGIN * 2;
}

// Height of the scroll viewport for a number of whole grid rows. The
// viewport never ends in the middle of a row.
export function gridViewportHeight(rows) {
    return rows * gridRowPitch() + GRID.PADDING_TOP + GRID.PADDING_BOTTOM;
}

// Number of whole rows that fit on screen. Four rows is the design limit;
// short monitors get fewer rows instead of a popup taller than the screen.
export function visibleGridRows(monitorHeight, chromeHeight) {
    const maxPopupHeight = Math.max(240, monitorHeight - 80);
    const available = maxPopupHeight - chromeHeight -
        GRID.PADDING_TOP - GRID.PADDING_BOTTOM;
    const rows = Math.floor(available / gridRowPitch());
    return Math.max(1, Math.min(GRID.MAX_VISIBLE_ROWS, rows));
}
