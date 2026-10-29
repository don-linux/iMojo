import { memo, useMemo, type Ref } from "react";
import type { Settings } from "../menus/model.ts";
import { rows } from "../menus/rows.ts";
import type { Frame, MenuData, Row } from "../menus/types.ts";

type MenuRowProps = {
  index: number;
  title: string;
  value?: string;
  centered: boolean;
  action: Row["action"];
  selected: boolean;
  idPrefix: string;
};

const MenuRow = memo(function MenuRow({
  index,
  title,
  value,
  centered,
  action,
  selected,
  idPrefix,
}: MenuRowProps) {
  const selectable = action !== "info";
  const className = ["menu-item", centered ? "centered" : "", selected ? "selected" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <li
      id={`${idPrefix}-${index}`}
      data-testid="menu-item"
      data-action={action}
      className={className}
      role={selectable ? "option" : undefined}
      aria-selected={selectable ? selected : undefined}
    >
      <span className="item-title" data-testid="item-title" dir="auto">
        {title}
      </span>
      {value ? (
        <span className="item-value" data-testid="item-value" dir="auto">
          {value}
        </span>
      ) : null}
      {action === "open" ? (
        <span className="chevron" data-testid="chevron" aria-hidden="true" />
      ) : null}
    </li>
  );
});

export function MenuScreen({
  frame,
  settings,
  data,
  idPrefix,
  listRef,
}: {
  frame: Frame;
  settings: Settings;
  data: MenuData;
  idPrefix?: string;
  listRef?: Ref<HTMLUListElement>;
}) {
  // Row contents ignore the highlight index, so a selection change keeps row props stable.
  const screenId = frame.id;
  const param = frame.param;
  const list = useMemo(
    () => rows({ id: screenId, index: 0, param }, settings, data),
    [screenId, param, settings, data],
  );
  const prefix = idPrefix ?? `menu-item-${screenId}`;
  return (
    <ul
      ref={listRef}
      className="menu-items"
      data-testid="menu-items"
      role="listbox"
      tabIndex={0}
      aria-labelledby="menu-title"
      aria-activedescendant={`${prefix}-${frame.index}`}
    >
      {list.map((row, index) => (
        <MenuRow
          key={`${index}:${row.id}`}
          index={index}
          title={row.title}
          value={row.value}
          centered={row.centered === true}
          action={row.action}
          selected={row.action !== "info" && index === frame.index}
          idPrefix={prefix}
        />
      ))}
    </ul>
  );
}
