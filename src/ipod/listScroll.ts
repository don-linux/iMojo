export const VISIBLE_MENU_ROWS = 6;
export const MENU_ROW_HEIGHT = 30;

/** Keep the selected row inside the 6-row window, matching scrollIntoView nearest. */
export function scrollTopForIndex(
  index: number,
  rowCount: number,
  scrollTop: number,
  rowHeight = MENU_ROW_HEIGHT,
  visibleRows = VISIBLE_MENU_ROWS,
) {
  if (rowCount <= 0 || rowHeight <= 0 || visibleRows <= 0) return 0;
  const maxStart = Math.max(0, rowCount - visibleRows);
  const selected = Math.min(Math.max(index, 0), rowCount - 1);
  let start = Math.round(scrollTop / rowHeight);
  if (start < 0) start = 0;
  else if (start > maxStart) start = maxStart;
  if (selected < start) start = selected;
  else if (selected >= start + visibleRows) start = selected - visibleRows + 1;
  if (start < 0) start = 0;
  else if (start > maxStart) start = maxStart;
  return start * rowHeight;
}
