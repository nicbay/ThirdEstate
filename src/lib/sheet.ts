// A detail sheet for phones: on narrow screens, a page's side panel (the selected department, district…) rises
// from the bottom instead of sitting below a tall map. Behaviour follows the Astryx BottomSheet spec for a sheet
// without a scrim: the page behind stays live, the sheet rests at snap points given as visible heights, a slow
// drag settles on the nearest one, a flick goes on to the next one in its direction, Escape folds it to its peek,
// and the grab bar is a real button (Enter/Space cycle the heights). Motion is pixel motion: steps, not springs,
// and none at all under prefers-reduced-motion. On wide screens nothing changes: the panel stays docked.
import { L } from "../i18n";

const NARROW = "(max-width: 860px)";
const FLICK = 0.45; // px/ms: faster than this, the release moves on to the next snap point

export function detailSheet(el: HTMLElement, label: string, opts: { snaps?: number[]; start?: number } = {}) {
  if (!matchMedia(NARROW).matches || el.dataset.sheet) return;
  el.dataset.sheet = "1";
  const snaps = (opts.snaps ?? [0.16, 0.52, 0.86]).slice().sort((a, b) => a - b);
  let at = Math.min(opts.start ?? 1, snaps.length - 1);
  const tabbar = () => (document.querySelector<HTMLElement>(".tabbar")?.offsetHeight ?? 0);
  const room = () => innerHeight - tabbar();
  const px = (i: number) => Math.round(snaps[i] * room());

  el.classList.add("px-sheet");
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", label);
  const body = document.createElement("div");
  body.className = "px-sheet-body";
  body.append(...el.childNodes);
  const grab = document.createElement("button");
  grab.type = "button";
  grab.className = "px-sheet-grab";
  el.replaceChildren(grab, body);
  const spacer = document.createElement("div");
  spacer.className = "px-sheet-space";
  spacer.setAttribute("aria-hidden", "true");
  el.after(spacer);

  const place = (visible: number, animate: boolean) => {
    el.style.transition = animate && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "" : "none";
    el.style.transform = `translateY(${Math.max(0, px(snaps.length - 1) - visible)}px)`;
  };
  const settle = (i: number, animate = true) => {
    at = Math.max(0, Math.min(snaps.length - 1, i));
    el.style.height = `${px(snaps.length - 1)}px`;
    el.style.bottom = `${tabbar()}px`;
    el.style.setProperty("--sheet-visible", `${px(at)}px`);
    spacer.style.height = `${px(0)}px`;
    place(px(at), animate);
    el.classList.toggle("is-peek", at === 0);
    grab.setAttribute("aria-expanded", String(at > 0));
    grab.setAttribute("aria-label", at === snaps.length - 1 ? L("Réduire le panneau", "Fold the panel") : L("Agrandir le panneau", "Expand the panel"));
  };

  // keyboard and taps on the grab bar: cycle up, and from the top back down to the peek
  let dragged = false;
  grab.addEventListener("click", () => { if (!dragged) settle(at === snaps.length - 1 ? 0 : at + 1); dragged = false; });
  el.addEventListener("keydown", (e) => { if (e.key === "Escape" && at > 0) { settle(0); grab.focus(); } });

  // drag from the grab bar or the panel's heading row
  let start: { y: number; visible: number } | null = null;
  let trail: { y: number; t: number }[] = [];
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    start = { y: e.clientY, visible: px(at) };
    trail = [{ y: e.clientY, t: e.timeStamp }];
    dragged = false;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer already gone: the drag still tracks over the bar */ }
  };
  const onMove = (e: PointerEvent) => {
    if (!start) return;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > 6) dragged = true; // a tap stays a tap
    if (!dragged) return;
    trail.push({ y: e.clientY, t: e.timeStamp });
    if (trail.length > 6) trail.shift();
    place(Math.max(px(0) * 0.6, Math.min(px(snaps.length - 1), start.visible - dy)), false);
  };
  const onUp = (e: PointerEvent) => {
    if (!start) return;
    const first = trail[0], v = first && e.timeStamp > first.t ? (first.y - e.clientY) / (e.timeStamp - first.t) : 0; // + = upward
    const visible = start.visible - (e.clientY - start.y);
    start = null;
    if (!dragged) return;
    if (Math.abs(v) > FLICK) { // a flick: the next snap point in its direction from where the drag began
      settle(at + (v > 0 ? 1 : -1));
    } else { // a slow drag: the nearest snap point to where it is
      let best = 0;
      snaps.forEach((_, i) => { if (Math.abs(px(i) - visible) < Math.abs(px(best) - visible)) best = i; });
      settle(best);
    }
  };
  for (const h of [grab]) {
    h.addEventListener("pointerdown", onDown);
    h.addEventListener("pointermove", onMove);
    h.addEventListener("pointerup", onUp);
    h.addEventListener("pointercancel", onUp);
  }
  addEventListener("resize", () => { if (el.isConnected) settle(at, false); });
  settle(at, false);
}
