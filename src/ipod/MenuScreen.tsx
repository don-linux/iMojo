import { rows, type Frame, type MenuData, type Row, type Settings } from "../menus.ts";

function MenuRow({ row, index, frame }: { row: Row; index: number; frame: Frame }) {
  const selectable = row.action !== "info";
  const selected = selectable && index === frame.index;
  const className = ["menu-item", row.centered ? "centered" : "", selected ? "selected" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <li
      id={`menu-item-${frame.id}-${index}`}
      data-testid="menu-item"
      data-action={row.action}
      className={className}
      role={selectable ? "option" : undefined}
      aria-selected={selectable ? selected : undefined}
    >
      <span className="item-title" data-testid="item-title" dir="auto">
        {row.title}
      </span>
      {row.value ? (
        <span className="item-value" data-testid="item-value" dir="auto">
          {row.value}
        </span>
      ) : null}
      {row.action === "open" ? (
        <span className="chevron" data-testid="chevron" aria-hidden="true" />
      ) : null}
    </li>
  );
}

export function MenuScreen({
  frame,
  settings,
  data,
}: {
  frame: Frame;
  settings: Settings;
  data: MenuData;
}) {
  const list = rows(frame, settings, data);
  return (
    <ul
      className="menu-items"
      data-testid="menu-items"
      role="listbox"
      tabIndex={0}
      aria-labelledby="menu-title"
      aria-activedescendant={`menu-item-${frame.id}-${frame.index}`}
    >
      {list.map((row, index) => (
        <MenuRow key={row.id} row={row} index={index} frame={frame} />
      ))}
    </ul>
  );
}
