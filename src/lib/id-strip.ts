// Profiles (MP, senator, candidate): once the header band scrolls away, a slim identity strip stays under the
// section bar with the photo in a pixel frame, the name and the party chip in its colour, so a long voting record
// never loses whose it is. It repeats the header, so it is hidden from assistive technology and holds no controls.
import { esc } from "../util";

let watch: IntersectionObserver | null = null;

export function identityStrip(page: HTMLElement) {
  const band = page.querySelector<HTMLElement>(":scope > .sec-hero");
  const head = band?.querySelector<HTMLElement>(".mp-head, .cand-head");
  if (!band || !head || page.querySelector(".id-strip")) return;
  const name = head.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim();
  if (!name) return;
  const img = head.querySelector<HTMLImageElement>("img");
  const chip = head.querySelector<HTMLElement>(".chip");
  const colour = (chip?.style.getPropertyValue("--c") || head.style.getPropertyValue("--c") || "").trim();
  const strip = document.createElement("div");
  strip.className = "id-strip";
  strip.setAttribute("aria-hidden", "true");
  if (colour) strip.style.setProperty("--c", colour);
  strip.innerHTML = `<div class="id-in">${img?.currentSrc || img?.src ? `<img src="${esc(img.currentSrc || img.src)}" alt="">` : ""}<b>${esc(name)}</b>${chip ? `<span class="chip">${esc(chip.textContent ?? "")}</span>` : ""}</div>`;
  page.append(strip);
  watch?.disconnect();
  watch = new IntersectionObserver(([e]) => strip.classList.toggle("is-on", !e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: "-120px 0px 0px 0px" });
  watch.observe(band);
}
