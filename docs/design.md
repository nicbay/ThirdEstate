# Third Estate design system

## Name and mark

**Third Estate** (*le tiers état*): in 1789 the commoners, everyone who was neither clergy nor nobility,
claimed their place in the Estates-General. Sieyès: *What is the Third Estate? Everything. What has it been
until now? Nothing. What does it ask? To become something.* The site is for that reader: the citizen, not
the insider. The name is English and reads instantly in French.

The mark is a **pixel-art fox head**, 16×16, drawn as `<rect>`s with `shape-rendering="crispEdges"`
(grid and `foxSvg(size, onDark)` in `src/lib/fox.ts`; `node scripts/build-brand.mjs` regenerates the favicon and
the share card from the same grid). Why a fox: alert, quick, hard to fool, the reader the site wants to equip when
someone in office explains themselves. The head is symmetrical: a bleu France outline `#000091`, rouge Marianne fur `#e1000f` on both sides,
a white blaze, snout and inner ears (`#ffffff`), ink eyes `#111216` and an ink nose: the three colours of the flag in one
face. On the black masthead and footer the outline takes a lighter blue `#5470ff` (bleu France would vanish on ink);
everything else stays. The red-left/blue-right split bar (active tab, kickers) is the political convention and is not
part of the mark. Keep the grid exact;
render it at multiples of 16px (24, 28, 32, 112) so pixels stay square. Wordmark: Archivo 850 condensed **THIRD** +
300 **ESTATE**, uppercase. Favicon: the fox on a rounded ink tile (`public/favicon.svg`). Pixel type (Silkscreen) is
allowed only for tiny accents, never for text people read (see "Pixel theme"). The 12×12 section icons of
the phone tab bar and the search glyph (`src/lib/pixel-icons.ts`) share the fox's pixel style, drawn in currentColor.
Catchphrase: Article 15 of the 1789 Declaration, *« La société a le droit de demander compte à tout agent public de son administration »*, shortened on the homepage to « Demander compte à tout agent public ». Share image: `public/og.png` (1200×630, screenshot of `docs/brand/og-source.html`).

A data desk, not a blog template. The page is a black-framed news product: one grotesk for
everything people read, a monospace for everything that annotates, a 3px ink rule to open
every section, and colour spent only on data. Every token (palette, night-band text, the red/blue split, pixel shapes, and semantic aliases named after the
Astryx design system: `--color-background-*`, `--color-text-*`, `--spacing-1…6`) lives in `src/styles/tokens.css`,
loaded before `style.css` and `redesign.css`; write new CSS against tokens, not hex values.

## Pixel theme (beta, `src/redesign.css`)

The frame takes its grammar from the fox. Loaded after `style.css`, the re-skin changes the chrome, not the data:

- **No curves in the frame.** Every corner is square (`border-radius: 0` site-wide); charts and maps are SVG and keep
  their own geometry. Panels (`.card`, doors, menus) and solid shapes (buttons, tags, photos) get **stepped corners**:
  a 9-slice pixel border (`--px-soft`, `--px-ink`, `--px-dark`) or the `--px-clip` polygon. A clipped shape loses its
  outline, so its focus ring is drawn inside (`.button:focus-visible`).
- **Page and surfaces.** The page is warm paper `--bg #f2f0e9`; sections are white panels on it. Dark bands (masthead,
  hero, footer) are `--night #0b0d18` with a faint grid of 2px squares, and dissolve into the page through two rows
  of 4px squares (`.px-edge`, `.foot-strip`).
- **Pixel type.** Silkscreen (self-hosted, OFL), for the smallest uppercase labels only: kickers, tags, the tab bar,
  menu indexes, footer heads. Never for a sentence, never for a number people compare.
- **Hard shadows, block motion.** Interactive panels lift up-left onto a hard offset shadow; presses and menu reveals
  move in `steps()`. The scroll bar under the masthead advances in 40 blocks. Sections below the fold rise in once
  as they enter the screen (`.rv-in`, added by `reveal()` in `src/main.ts`): nothing waits hidden, and all of it is
  off under `prefers-reduced-motion`.
- **The hero's 577 dots are pixels** (squares), on the map and in the hemicycle.

## Pixel Desk v2 (beta, `src/styles/overhaul.css`)

The overhaul keeps the pixel grammar and calms the frame. Loaded last, written against `src/styles/tokens.css`.
Component behaviour follows the Astryx design system's specs (read through its MCP); Astryx itself is not installed
(React + StyleX, ~49 KB gzip for the touch helpers alone), so components are small vanilla TS/CSS.

- **Answer first.** Inner pages open with a headline strip, not a hero: kicker, headline (≤ 2.9rem), dek, then the
  main chart inside the first screen. The tall dark hero is the homepage's alone.
- **One local bar.** Under the masthead, the section's pages; a page's own views (`.page-tabs`, e.g. the Assemblée's
  map / who they are / toeing the line / what they say) are moved into that bar by `mergeLocalTabs()` in `src/main.ts`,
  nested after their page. No second row of tabs.
- **Calm panels.** A static section (`.card`) is a white sheet opened by a 3px ink rule. The stepped pixel frame and
  the hard shadow mean *clickable*: next steps, candidate cards, quiz picks, simulator cards.
- **Detail sheet** (`src/lib/sheet.ts`, Astryx BottomSheet spec, no scrim). Up to 860px a page's side panel
  (Assemblée: the picked department) rises from the bottom over the map: peek / half / near-full snap points, slow
  drags settle on the nearest, flicks go to the next, Escape folds to the peek, the grab bar is a button. Steps, not
  springs; none under reduced motion. Desktop keeps the docked panel.
- **Dark theme.** Follows the system; the masthead sun/moon button overrides it (`localStorage` `te-theme`, applied
  before paint by `public/theme-boot.js`). Only the paper side flips; night bands stay night. Party colours stay data,
  with one exception: RN's navy `#1c2c6c` lifts to `#6a78e0` so it stays legible on dark paper.
- **The kit** (`#/kit`, beta and local hosts only, `src/views/kit.ts`): every token and component on one page.

Navigation: six sections (Chez vous, Parlement, 2027, **Programmes**, La France, Archives). On desktop each opens one
panel as wide as the page column: what the section is, then its pages with a one-line description (the Programmes
panel also lists every candidate). Below 900px: a bottom tab bar with four sections and **Menu**, which opens a
full-screen sheet (search, quiz, every section and page, language). A pixel button returns to the top of long pages.

Programmes hub (`#/programmes`, `src/views/programmes-hub.ts`): the candidates left to right, the same theme side by
side, claimed against estimated cost, legal obstacles and feasibility. Its data is `public/data/programmes/compare.json`,
written with the index by `scripts/build-programmes-index.mjs`. Same rule as the candidate pages: descriptive,
same criteria for everyone.

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
   `src/lib/motion.ts` runs the rest: the fox assembles (once a session), blinks, and breathes while a page
   loads; pages cross over under a still masthead (View Transitions); figures count up, hemicycles fill group by
   group and word clouds fall into place the first time they come into view. Nothing waits hidden for an
   observer: content is complete at rest, and moments start only on screen, in under ~400 ms.
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

- **Masthead**: black bar, the fox and the condensed wordmark, five sections (Chez vous, Parlement, 2027, La France,
  Archives), each a link plus a caret button that opens its menu (white panel, 3px ink rule; hover on desktop, click or
  keyboard everywhere, Esc closes). Active section underlined with the red/blue split bar. Right side: search button
  (Ctrl/⌘ K), the white "Qui vous ressemble ?" call to action (red/blue offset shadow) to `#/quiz`, FR/EN. The current
  section's pages repeat in a row under the bar. Below 760px: one top row (mark, search, quiz, language), the section
  pages as a sideways-scrolling row, and a fixed bottom tab bar with the five sections (pixel icon + short label,
  safe-area padding).
- **Search** (`src/lib/search.ts`): Ctrl/⌘ K or "/" opens a modal palette over towns, MPs, senators, chamber words and
  pages; grouped results with mono type tags, ↑↓ Enter Esc, recent picks remembered. Data loads on first open.
- **Section (`.card`)**: 3px ink rule, condensed `h2`, mono "→" link at the right.
- **Tabs**: pill row (`.tabs`), segmented control for in-module switches (`.small-tabs`).
- **Bars**: 10px on a `--wash` track, bold value right-aligned, grow-in animation.
- **KPIs / `.lk` / hero stats**: 2px ink rule on top, big condensed number, mono label.
- **Spectrum strip**: 58px (40px on phones), parties in seating order, axis labelled ← LEFT / RIGHT →
  in the left/right colours.
- **Tables**: mono uppercase headers over a 2px ink rule, tabular right-aligned numbers, hover rows,
  auto-wrapped in `.table-scroll` by `src/main.ts`.
- **Doors**: grey panels with an ink top rule and a violet arrow. The homepage hero has five, one per section (Chez vous, Parlement, 2027, La France, Archives).
- **Tooltip**: ink background, white text, first line bold.
- **Town search box**: 2px ink box with a hard offset shadow and a drawn magnifier; violet on focus.
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

## Pages rebuilt on the pixel theme

Each keeps its styles in its own file under `src/styles/`, imported by its view.

- **Shift map** (`shifts.css`): the map sits on a night stage; the timeline of election pairs is the control
  (click, drag, arrow keys, play); arrows swing from one pair to the next; a card replaces the tooltip; the list
  of biggest moves lights its arrow. The homepage card keeps the light version. Encoding rules above are unchanged.
- **Simulator** (`simulator.css`): scenario cards computed from the polls, a first round → qualifiers → runoff
  strip, undo/redo, transfers badged measured or assumed, pin and compare.
- **Quiz** (`quiz.css`): a short version (10 Assembly votes chosen to separate the candidates) and a long one
  (plus two measures per candidate, unnamed until the results); deal breakers and compatibles per candidate; the
  reader's place on the left–right axis, overall and subject by subject. Proximity, never voting advice.
- **Town photos** are the plain Wikimedia Commons photograph, credited under the picture. No pixel treatment.
