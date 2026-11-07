# Third Estate design system

## Name and mark

**Third Estate** (*le tiers état*): in 1789 the commoners, everyone who was neither clergy nor nobility,
claimed their place in the Estates-General. Sieyès: *What is the Third Estate? Everything. What has it been
until now? Nothing. What does it ask? To become something.* The site is for that reader: the citizen, not
the insider. The name is English and reads instantly in French.

The mark is three rising bars, Sieyès' *nothing, something, everything*, which also reads as a bar chart.
The third bar is the people, split red (left) and blue (right) in the French convention, the same split as
the active-tab underline. Wordmark: Archivo 850 condensed **THIRD** + 300 **ESTATE**, uppercase. Favicon:
the mark on the ink tile. Catchphrase: Article 15 of the 1789 Declaration, *« La société a le droit de demander compte à tout agent public de son administration »*, shortened on the homepage to « Demander compte à tout agent public ». Share image: `public/og.png` (1200×630).

A data desk, not a blog template. The page is a black-framed news product: one grotesk for
everything people read, a monospace for everything that annotates, a 3px ink rule to open
every section, and colour spent only on data. Tokens live at the top of `src/style.css`.

## Principles

1. **Colour is data.** Chrome is black, white and warm grey. Red, pink, green, yellow, blue and navy
   only appear when they stand for a political family.
2. **Direction is meaning.** On shift maps, leaning right means moved right (blue), leaning left means
   moved left (red). Non-partisan measures (far-right share, turnout) use vertical arrows and never
   point left or right.
3. **Numbers first.** Key figures are set big, condensed and tabular; labels sit under them in mono.
4. **Annotate like a desk.** Kickers, axis labels, table headers and sources are IBM Plex Mono, uppercase
   where short.
5. **Motion explains.** Bars grow from zero, the spectrum strip fills left to right, arrows grow from their
   origin in a west-to-east sweep, polling lines draw in. All of it is off under `prefers-reduced-motion`.
6. **Phone first for data.** Charts switch to a narrower canvas below 640px so labels stay legible; maps
   size arrowheads in screen pixels; wide tables scroll inside their own box; tab rows scroll sideways.
   Nothing makes the page scroll horizontally at 375px.

## Type

Fonts (Google Fonts): **Archivo** (variable, `wdth` 62–125, `wght` 100–900) and **IBM Plex Mono**.

| Role | Spec |
|------|------|
| Page headline `h1` | Archivo 800, width 78%, `clamp(2.15rem, 1.25rem + 3.4vw, 3.75rem)`, line-height 0.98, tracking −0.022em, max 20ch |
| Home headline | same, up to 4.6rem, max 15ch |
| Section head `h2` | Archivo 800, width 82%, `clamp(1.3rem, 1.1rem + 0.7vw, 1.6rem)` |
| Sub-head `h3` | Archivo 700, 1.02rem |
| Dek | Archivo 400, `clamp(1.05rem, …, 1.24rem)`, `--ink-2` |
| Body | Archivo 400, 17px / 1.55 |
| Big number (KPIs, hero stats, shift total) | Archivo 800, width 75–80%, 1.9–2.6rem, tabular |
| Kicker / eyebrow | Plex Mono 500, 0.74rem, uppercase, +0.09em, preceded by the red/blue split bar |
| Table header, axis, source, captions | Plex Mono 500–600, 0.66–0.74rem, uppercase for labels |

Numbers use `font-variant-numeric: tabular-nums lining-nums`; negative shifts use a true minus (−).

## Colour tokens

Neutrals: `--paper #fff`, `--panel #f5f4f0` (modules, hover rows), `--wash #e8e6df` (empty map areas,
bar tracks), `--ink #111216`, `--ink-2 #474c56` (8.6:1), `--ink-3 #686d77` (5.1:1), `--rule #e1e0da`,
`--rule-2 #c8c7c0`.

Interaction: `--accent #4b2fd0` (violet, deliberately no party's colour) for links, focus rings, hover
states; `--link #3d23b8`.

Political families (French convention):

| Token | Hex | Used for |
|-------|-----|----------|
| `--far-left` | `#9c1022` | LO, NPA |
| `--left` | `#d4253a` | left bloc, LFI/NFP, "moved left" arrows |
| `--soc` | `#e8559a` | PS, misc. left |
| `--eco` | `#1e9e57` | ecologists |
| `--centre` | `#f2a400` | Renaissance/Ensemble (MoDem `#f77f00`, Horizons `#36a3d9`) |
| `--right` | `#1f5fcf` | LR, right bloc, "moved right" arrows |
| `--far-right` | `#1c2c6c` | RN and allies (Reconquête dark brown `#4a2c1d`) |
| `--other` | `#9aa0aa` | others |

Party colours for candidates and 2024 nuances live in `src/lib/candidates.ts`; Assemblée group colours
come from open data and pass through `safeColor()`.

Vote positions: for `--P #1d8a4b`, against `--C #c42637`, abstain `--A #c99a2e`. Poll deltas use ▲/▼
glyphs as well as colour.

## Components

- **Masthead**: black bar, logo mark (a red arrow up-left and a blue arrow up-right from one origin, which
  reads as a V), condensed wordmark, active section underlined with the red/blue split bar. Below 760px
  the nav becomes a horizontal scroller with a fade at the edge.
- **Section (`.card`)**: 3px ink rule, condensed `h2`, mono "→" link at the right.
- **Tabs**: pill row (`.tabs`), segmented control for in-module switches (`.small-tabs`).
- **Bars**: 10px on a `--wash` track, bold value right-aligned, grow-in animation.
- **KPIs / `.lk` / hero stats**: 2px ink rule on top, big condensed number, mono label.
- **Spectrum strip**: 58px (40px on phones), parties in seating order, axis labelled ← LEFT / RIGHT →
  in the left/right colours.
- **Tables**: mono uppercase headers over a 2px ink rule, tabular right-aligned numbers, hover rows,
  auto-wrapped in `.table-scroll` by `src/main.ts`.
- **Doors**: grey panels with an ink top rule and a violet arrow.
- **Tooltip**: ink background, white text, first line bold.
- **Search**: 2px ink box with a hard offset shadow and a drawn magnifier; violet on focus.
- **Overseas insets**: 100×100 tiles with a mono caption. "French abroad" is a peer tile: a globe filled
  with the area's colour, same caption, same hover/selected strokes (`abroadInset()` in `src/lib/map.ts`).

## Maps

- Projection: conic conformal, parallels 44°/49°, rotated −3°, fitted to the box.
- Empty areas `--wash` / `--panel`, white 1px borders; hover = ink stroke, selected = 2.6px ink stroke.
- Choropleth strength = opacity (stronger colour, wider lead).
- **Shift arrows** (`src/views/shifts.ts`):
  - `lr` = right share − left share; the arrow is drawn for the change `d` between the two elections.
    `d > 0`: tilted 30° up and to the **right**, blue `#1f5fcf`, "moved right".
    `d < 0`: tilted 30° up and to the **left**, red `#d4253a`, "moved left".
  - Far-right share and turnout: vertical arrows (up = rose, down = fell), navy / light navy and
    violet / grey, so they can never be read as a left/right movement.
  - Length = |d| × 2.2 user units per point (districts) or × 3 (departments), capped at 90.
    A legend key shows what 10 points looks like on screen.
  - Filled triangular heads and stroke widths are sized in **screen pixels** (`unitsPerPx`), so arrows
    keep a visible head on a 340px-wide phone map; maps redraw on large resizes.
  - Larger arrows are drawn first so small ones stay visible; arrows under 0.3 points are skipped.
  - Paris and the inner suburbs get an inset at the same on-screen scale per point, with a box marking
    the area on the main map.
  - The legend uses the exact same arrow glyphs as the map.

## Charts

- Line charts (`src/lib/chart.ts`): light grid, ink baseline at 0, "%" on the top tick only, mono axis
  labels, 2.6px lines over a white halo, direct end labels (name + bold value) nudged apart, poll dots at
  30% opacity. Below 640px a 520-unit canvas with larger labels; long labels are shortened with "…".
- Hemicycle: one dot per seat, seating order, dashed majority line, condensed total.
- No legends where a direct label fits; no 3D, no gradients except the lean meters.

## Accessibility

- Text contrast ≥ 4.5:1 (ink-3 is the lightest text colour).
- 3px violet focus ring on everything focusable; the French-abroad tile is a real button with
  `aria-pressed`.
- All motion is disabled under `prefers-reduced-motion: reduce`.
- Charts and maps carry `role="img"` and labels; every map area has a tooltip and a title.
