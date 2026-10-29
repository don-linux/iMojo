type GestureDetail = Event & { key?: string; repeat?: boolean; pointerType?: string };

export function gestureAction(event: Event): "unlock" | "construct" | "ignore" {
  const detail = event as GestureDetail;
  if (event.type === "keydown") {
    if (detail.repeat || detail.key === "Escape") return "ignore";
    return "unlock";
  }
  // Touch and pen pointerdown are not activation. Mouse pointerdown is.
  if (event.type === "pointerdown") return detail.pointerType === "mouse" ? "unlock" : "construct";
  if (event.type === "pointerup") return detail.pointerType === "mouse" ? "ignore" : "unlock";
  if (event.type === "touchend" || event.type === "click") return "unlock";
  return "ignore";
}
