// InfoTip: a small pixel "i" button next to a label or a figure that explains it (what a number counts, how it is
// made). Behaviour follows the Astryx InfoTip spec (the toggletip pattern): hover and keyboard focus preview the help,
// a click, tap, Enter or Space pins it open (aria-expanded="true", announced once), and Escape, a second press, a
// press outside or focus leaving closes it. One delegated handler serves every tip on the site; views only emit
// markup with infoTip(). Content is short plain text; anything a reader needs to act stays inline.
import { L } from "../i18n";
import { esc } from "../util";

let seq = 0;
/** Markup for a tip. `label` names the button ("About the poll average"); `text` is the help. */
export function infoTip(text: string, label = L("En savoir plus", "More information")) {
  const id = `px-tip-${++seq}`;
  return `<span class="px-info"><button type="button" class="px-info-btn" aria-label="${esc(label)}" aria-expanded="false" aria-controls="${id}" aria-describedby="${id}">i</button><span class="px-info-pop" role="tooltip" id="${id}" hidden>${esc(text)}</span></span>`;
}

let pinned: HTMLElement | null = null;
let live: HTMLElement | null = null;
const popOf = (btn: HTMLElement) => btn.parentElement!.querySelector<HTMLElement>(".px-info-pop")!;

function place(btn: HTMLElement, pop: HTMLElement) {
  pop.hidden = false;
  pop.classList.remove("is-left", "is-up");
  const r = pop.getBoundingClientRect();
  if (r.right > document.documentElement.clientWidth - 8) pop.classList.add("is-left");
  if (r.bottom > innerHeight - 70) pop.classList.add("is-up");
}
function show(btn: HTMLElement) { place(btn, popOf(btn)); }
function hide(btn: HTMLElement) { if (pinned === btn) return; popOf(btn).hidden = true; }
function pin(btn: HTMLElement) {
  if (pinned && pinned !== btn) unpin();
  pinned = btn;
  btn.setAttribute("aria-expanded", "true");
  show(btn);
  // announced once when pinned
  if (!live) { live = document.createElement("div"); live.className = "sr-only"; live.setAttribute("aria-live", "polite"); document.body.append(live); }
  live.textContent = popOf(btn).textContent ?? "";
}
function unpin() {
  if (!pinned) return;
  const b = pinned;
  pinned = null;
  b.setAttribute("aria-expanded", "false");
  popOf(b).hidden = true;
}

export function initInfoTips() {
  const btnOf = (t: EventTarget | null) => (t as Element | null)?.closest?.<HTMLElement>(".px-info-btn") ?? null;
  document.addEventListener("click", (e) => {
    const b = btnOf(e.target);
    if (b) { e.preventDefault(); if (pinned === b) unpin(); else pin(b); return; }
    if (pinned && !(e.target as Element).closest?.(".px-info")) unpin();
  });
  document.addEventListener("pointerover", (e) => { const b = btnOf(e.target); if (b && (e as PointerEvent).pointerType === "mouse") show(b); });
  document.addEventListener("pointerout", (e) => { const b = btnOf(e.target); if (b && (e as PointerEvent).pointerType === "mouse") hide(b); });
  document.addEventListener("focusin", (e) => { const b = btnOf(e.target); if (b) show(b); });
  document.addEventListener("focusout", (e) => { const b = btnOf(e.target); if (!b) return; if (pinned === b) unpin(); else hide(b); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const b = btnOf(document.activeElement);
    if (pinned) { unpin(); e.stopPropagation(); } else if (b) popOf(b).hidden = true;
  });
  addEventListener("hashchange", unpin);
}
