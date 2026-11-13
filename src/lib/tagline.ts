// The tagline reveal: a large statement whose words light up one at a time, in reading order, as they cross a
// trigger line (40 % up from the bottom of the screen). One IntersectionObserver for all the words; words that cross
// together (a whole line) are staggered 70ms apart so they never flip as a block. Once lit, a word stays lit.
// Under reduced motion (or without IntersectionObserver) the text is simply shown at full colour.

export function taglineReveal(el: HTMLElement | null) {
  if (!el || el.dataset.split) return;
  el.dataset.split = "1";
  const text = el.textContent ?? "";
  el.setAttribute("aria-label", text.trim());
  el.innerHTML = text.trim().split(/\s+/).map((w) => `<span class="tw" aria-hidden="true">${w.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</span>`).join(" ");
  const words = [...el.querySelectorAll<HTMLElement>(".tw")];
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
    words.forEach((w) => w.classList.add("on"));
    return;
  }
  el.classList.add("is-armed");
  const order = new Map(words.map((w, i) => [w, i]));
  const io = new IntersectionObserver((entries) => {
    const hit = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement).sort((a, b) => order.get(a)! - order.get(b)!);
    hit.forEach((w, k) => {
      w.style.transitionDelay = `${k * 70}ms`;
      w.classList.add("on");
      io.unobserve(w);
    });
  }, { rootMargin: "0px 0px -40% 0px", threshold: 0 });
  words.forEach((w) => io.observe(w));
}
