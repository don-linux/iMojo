export type ScreenKeyTarget = {
  tagName: string;
  inputType: string | null;
  editable: boolean;
  inDialog: boolean;
  inIpod: boolean;
  inWheel: boolean;
};

export type ScreenKeyAction = "ignore" | "defer" | "handle";

export function navigationKey(stack: readonly { id: string; param?: string }[]) {
  return stack.map((frame) => `${frame.id}:${frame.param ?? ""}`).join("/");
}

function isTextEntry(target: ScreenKeyTarget) {
  if (target.editable) return true;
  const tag = target.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag !== "input") return false;
  return (target.inputType ?? "text").toLowerCase() !== "range";
}

/** `defer` leaves the event for the click-wheel listener (or the button's native click). */
export function screenKeyAction(target: ScreenKeyTarget): ScreenKeyAction {
  if (!target.inIpod || target.inDialog) return "ignore";
  if (isTextEntry(target)) return "ignore";
  if (target.inWheel) return "defer";
  return "handle";
}

export function describeKeyTarget(target: EventTarget | null): ScreenKeyTarget | null {
  if (typeof Element === "undefined" || !(target instanceof Element)) return null;
  return {
    tagName: target.tagName,
    inputType: target instanceof HTMLInputElement ? target.type : null,
    editable: target instanceof HTMLElement && target.isContentEditable,
    inDialog: target.closest(".client-id-dialog") != null,
    inIpod: target.closest(".ipod") != null,
    inWheel: target.closest(".click-wheel") != null,
  };
}

export function screenKeyActionFor(target: EventTarget | null): ScreenKeyAction {
  const described = describeKeyTarget(target);
  if (!described) return "ignore";
  return screenKeyAction(described);
}
