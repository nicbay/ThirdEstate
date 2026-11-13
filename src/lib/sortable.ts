// Sortable data tables, applied to every table.table after a render (enhance() in main.ts). A table with a head and
// at least 6 body rows gets a button in each column header (aria-sort on the th, as in the Astryx Table sorting
// spec); a numeric column sorts high-to-low first, a text column A-to-Z. Rows that sum up a table (Total, France,
// Ensemble) stay at the bottom. Rows are moved, not re-rendered, so their listeners survive. Opt out with
// data-nosort on the table. Tables that fit their column also get a sticky header row on wide screens.
import { getLang } from "../i18n";

const SUMMARY = /^(total|ensemble|france|toutes?|all|moyenne|average)\b/i;
const collator = () => new Intl.Collator(getLang() === "fr" ? "fr" : "en", { numeric: true, sensitivity: "base" });

function num(text: string): number {
  let s = text.replace(/[   ]/g, " ").replace(/−/g, "-").trim();
  s = s.replace(/(\d) (?=\d{3}\b)/g, "$1");
  s = getLang() === "fr" ? s.replace(/(\d),(\d)/g, "$1.$2") : s.replace(/(\d),(?=\d{3}\b)/g, "$1");
  const m = s.match(/[-+]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

export function sortableTables(root: ParentNode) {
  root.querySelectorAll<HTMLTableElement>("table.table:not([data-nosort]):not([data-sortable])").forEach((table) => {
    table.dataset.sortable = "1";
    const head = table.tHead?.rows[0];
    const body = table.tBodies.length === 1 ? table.tBodies[0] : null;
    if (!head || !body || body.rows.length < 6) return;
    if ([...table.querySelectorAll("td, th")].some((c) => (c as HTMLTableCellElement).rowSpan > 1 || (c as HTMLTableCellElement).colSpan > 1)) return;
    const cols = head.cells.length;
    if ([...body.rows].some((r) => r.cells.length !== cols)) return;
    const original = [...body.rows];
    [...head.cells].forEach((th, i) => {
      if (!th.textContent?.trim()) return;
      const cells = original.map((r) => r.cells[i].textContent ?? "");
      const isNum = cells.filter((t) => !Number.isNaN(num(t))).length >= cells.length * 0.7;
      th.setAttribute("aria-sort", "none");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "th-sort";
      btn.append(...th.childNodes);
      btn.insertAdjacentHTML("beforeend", `<span class="th-ar" aria-hidden="true"></span>`);
      th.append(btn);
      btn.addEventListener("click", () => {
        const now = th.getAttribute("aria-sort");
        const dir = now === "none" ? (isNum ? "descending" : "ascending") : now === "descending" ? "ascending" : "descending";
        head.querySelectorAll("th[aria-sort]").forEach((h) => h.setAttribute("aria-sort", "none"));
        th.setAttribute("aria-sort", dir);
        const sign = dir === "ascending" ? 1 : -1;
        const col = collator();
        const rows = [...body.rows];
        const pinned = rows.filter((r) => SUMMARY.test(r.cells[0].textContent?.trim() ?? ""));
        const rest = rows.filter((r) => !pinned.includes(r));
        rest.sort((a, b) => {
          const x = a.cells[i].textContent ?? "", y = b.cells[i].textContent ?? "";
          if (isNum) {
            const p = num(x), q = num(y);
            if (Number.isNaN(p) || Number.isNaN(q)) return Number.isNaN(p) ? (Number.isNaN(q) ? 0 : 1) : -1; // blanks last
            return (p - q) * sign;
          }
          return col.compare(x, y) * sign;
        });
        body.append(...rest, ...pinned);
      });
    });
  });
  // sticky header rows: only when the table fits (a sideways-scrolling box cannot hold a sticky header)
  root.querySelectorAll<HTMLElement>(".table-scroll, .table-wrap").forEach((box) => {
    const t = box.querySelector("table");
    box.classList.toggle("fits", !!t && t.scrollWidth <= box.clientWidth + 1);
  });
}
