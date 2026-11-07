// One floating tooltip for every map area, chart dot and seat.
// Elements opt in with a <title> child (SVG) or a data-tip attribute; the first hover moves the
// <title> text into data-tip so the browser's own slow tooltip doesn't show as well.

let tip: HTMLDivElement | null = null;

function textFor(el: Element): string | null {
  const own = (el as HTMLElement).dataset?.tip;
  if (own) return own;
  const title = el.querySelector(":scope > title");
  if (!title) return null;
  const text = title.textContent ?? "";
  (el as HTMLElement).dataset.tip = text;
  title.remove();
  return text;
}

export function initTooltip() {
  tip = document.createElement("div");
  tip.className = "tip";
  tip.hidden = true;
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);

  const target = (e: Event) => (e.target as Element).closest?.("[data-tip], path.area, path.dep, circle.dot, circle.seat, .spectrum-bar span") ?? null;

  document.addEventListener("pointerover", (e) => {
    const el = target(e);
    const text = el && textFor(el);
    if (!text || !tip) return;
    tip.textContent = text;
    tip.hidden = false;
  });
  document.addEventListener("pointermove", (e) => {
    if (!tip || tip.hidden) return;
    const pad = 14;
    const { innerWidth: w, innerHeight: h } = window;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(e.clientX + pad, w - r.width - 8)}px`;
    tip.style.top = `${e.clientY + pad + r.height > h ? e.clientY - r.height - pad : e.clientY + pad}px`;
  });
  document.addEventListener("pointerout", (e) => {
    if (tip && target(e)) tip.hidden = true;
  });
  window.addEventListener("hashchange", () => tip && (tip.hidden = true));
}
