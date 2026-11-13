// Toasts: brief, non-blocking confirmations ("Saved as your town", "Link copied"). Behaviour follows the Astryx
// Toast / useToast spec: a polite live region that never takes focus, auto-hide that pauses while the pointer or
// focus is on the toast, a uniqueID that replaces a toast instead of stacking a copy, an optional action (Undo,
// a link), a close button, and a returned dismiss function. Not for errors that need acknowledging.
import { L } from "../i18n";
import { pixelIcon } from "./pixel-icons";
import { esc } from "../util";

type Action = { label: string; href?: string; onClick?: () => void };
export type ToastOptions = { type?: "info" | "error"; duration?: number; autoHide?: boolean; uniqueID?: string; action?: Action };

let viewport: HTMLElement | null = null;
const live = new Map<string, () => void>();
const MAX = 3;

function ensureViewport() {
  if (viewport?.isConnected) return viewport;
  viewport = document.createElement("div");
  viewport.className = "px-toasts";
  viewport.setAttribute("role", "status");
  viewport.setAttribute("aria-live", "polite");
  document.body.append(viewport);
  return viewport;
}

export function toast(body: string, opts: ToastOptions = {}): () => void {
  const box = ensureViewport();
  if (opts.uniqueID) live.get(opts.uniqueID)?.();
  const el = document.createElement("div");
  el.className = `px-toast${opts.type === "error" ? " is-error" : ""}`;
  const action = opts.action
    ? opts.action.href ? `<a class="px-toast-act" href="${esc(opts.action.href)}">${esc(opts.action.label)}</a>` : `<button type="button" class="px-toast-act">${esc(opts.action.label)}</button>`
    : "";
  el.innerHTML = `<p>${esc(body)}</p>${action}<button type="button" class="px-toast-x" aria-label="${L("Fermer", "Dismiss")}">${pixelIcon("close", 12)}</button>`;
  let timer = 0, gone = false;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    if (opts.uniqueID && live.get(opts.uniqueID) === dismiss) live.delete(opts.uniqueID);
    el.classList.add("is-out");
    setTimeout(() => el.remove(), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180);
  };
  const ms = opts.duration ?? 5000;
  const arm = () => { if (opts.autoHide !== false) { clearTimeout(timer); timer = window.setTimeout(dismiss, ms); } };
  const hold = () => clearTimeout(timer);
  el.addEventListener("pointerenter", hold);
  el.addEventListener("pointerleave", arm);
  el.addEventListener("focusin", hold);
  el.addEventListener("focusout", (e) => { if (!el.contains(e.relatedTarget as Node)) arm(); });
  el.querySelector(".px-toast-x")!.addEventListener("click", dismiss);
  const act = el.querySelector<HTMLElement>(".px-toast-act");
  act?.addEventListener("click", () => { opts.action?.onClick?.(); dismiss(); });
  box.append(el);
  while (box.children.length > MAX) (box.firstElementChild as HTMLElement).remove();
  if (opts.uniqueID) live.set(opts.uniqueID, dismiss);
  arm();
  return dismiss;
}
