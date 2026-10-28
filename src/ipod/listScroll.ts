export function scrollListToRow(list: HTMLElement, row: HTMLElement) {
  const rowHeight = row.offsetHeight;
  if (rowHeight <= 0) return;
  const top = row.offsetTop - list.offsetTop - list.clientTop;
  const index = Math.max(0, Math.round(top / rowHeight));
  const visible = Math.max(1, Math.floor((list.clientHeight + 0.5) / rowHeight));
  let start = Math.round(list.scrollTop / rowHeight);
  if (index < start) start = index;
  else if (index >= start + visible) start = index - visible + 1;
  const next = Math.max(0, start) * rowHeight;
  const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
  list.scrollTop = Math.min(next, maxScroll);
}
