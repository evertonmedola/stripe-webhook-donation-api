---
name: Catraca Financeira
description: A mechanical tally-counter donation instrument — the amount is counted, not displayed.
colors:
  gunmetal-bg: "#34383d"
  gunmetal-bg-light: "#3d4147"
  panel: "#202226"
  panel-shadow: "#121315"
  metal-highlight: "#5b6067"
  metal-highlight-soft: "#46494f"
  brass: "#b8874f"
  brass-light: "#d9ab6e"
  brass-dim: "#7a5f3f"
  amber: "#e2a23c"
  amber-strong: "#f0b45a"
  text: "#eef0f0"
  text-muted: "#b3b8bd"
  error: "#d1495b"
  error-bg: "rgba(209, 73, 91, 0.14)"
typography:
  display:
    fontFamily: "Big Shoulders Display, IBM Plex Sans, sans-serif"
    fontSize: "1.9rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0.01em"
  body:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.92rem-1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "0.78rem-0.8rem"
    fontWeight: 600
    letterSpacing: "0.04em-0.06em"
    textTransform: "uppercase"
  data:
    fontFamily: "Space Mono, monospace"
    fontSize: "1rem-2.75rem"
    fontWeight: 700
    letterSpacing: "-0.02em"
    fontFeature: "tabular-nums"
rounded:
  sm: "3px"
  base: "6px"
spacing:
  xs: "0.4rem"
  sm: "0.75rem"
  md: "1.25rem"
  lg: "1.75rem"
  xl: "2.5rem"
components:
  button-primary:
    backgroundColor: "transparent"
    textColor: "{colors.brass-light}"
    typography: "{typography.label}"
    rounded: "{rounded.base}"
    padding: "0.75rem 1rem"
  button-primary-hover:
    backgroundColor: "{colors.amber}"
    textColor: "#201703"
    rounded: "{rounded.base}"
    padding: "0.75rem 1rem"
  input-field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.data}"
    rounded: "{rounded.base}"
    padding: "0.65rem 0.75rem"
---

# Design System: Catraca Financeira

## Overview

**Creative North Star: "The Mechanical Tally-Counter"**

The donation amount is not displayed on a card — it is counted, on a physical instrument. The whole surface is built around a brushed-metal digit-wheel readout (`.counter`) that owns the first viewport before any copy loads, and every other element (buttons, inputs, dividers) is styled as hardware attached to that instrument: brass fittings, rivets, gunmetal housing. This is a Persuade-mode donation surface deliberately built as an industrial payment instrument rather than a SaaS landing page, honoring the product brief's explicit refusal of the purple-blue-gradient / rounded-icon-tile / cards-in-cards default.

The palette stays cold and mechanical: gunmetal steel-gray structure and dulled brass fittings at rest, with warm amber held back exclusively for actionable or live states (hover, focus, active, loading, payment-confirmed). Nothing decorative is amber. Typography splits roles by material logic, not fashion: a condensed industrial display face for headings, a neutral humanist sans for prose and controls, and a monospace exclusively for digits and currency — the one "technical costume" this world earns, because the counter is a measuring instrument, not an accent.

Two rejected devices are worth naming because the build actively removed them during finish review: a zero-blur hard-offset ("neobrutalist") shadow on the counter, rejected in favor of a soft ambient shadow this steel/brass world never earned the right to wear; and a Unicode arrow glyph (`&larr;`) on the cancel-page back-link, rejected because back-links communicate through brass-to-amber underline color shift alone, never a glyph standing in for an icon.

**Key Characteristics:**
- A full-width mechanical counter housing is the signature object and the only "card" in the system — no nested cards, no rounded icon tiles.
- Amber is reserved strictly for actionable/live/confirmation states; it never fills decoratively.
- Space Mono is reserved strictly for digits and currency figures; it is never used for prose, labels, or dividers.
- Two named digit animations (`digit-tick`, `digit-confirm`) are the system's only motion vocabulary.
- Single-column, mobile-first, capped at 440px, with one narrow-viewport step that only rescales the counter.

## Colors

Cold gunmetal structure, dulled brass hardware, and amber held on a short leash for interaction only.

### Primary
- **Gunmetal** (`#34383d`, lighter `#3d4147`): the page ground, rendered as a soft radial gradient — cool steel, never warm cream or near-black.
- **Brass** (`#b8874f`, light `#d9ab6e`, dim `#7a5f3f`): the default structural/interactive color — borders, rivets, dividers, button text and outline, link color at rest.
- **Amber** (`#e2a23c`, strong `#f0b45a`): reserved strictly for actionable and live states — button hover/focus/active fill, input focus ring, loading spinner, the `digit-tick` and `digit-confirm` flash, credit-link hover. Never applied as decoration or passive fill.

### Neutral
- **Panel** (`#202226`, shadow `#121315`): the counter housing's dark gradient base and input/prefix backgrounds.
- **Metal Highlight** (`#5b6067`, soft `#46494f`): brushed-metal sheen in the counter's gradient and rivet highlights; also the desaturated tone for disabled buttons.
- **Text** (`#eef0f0`) / **Text Muted** (`#b3b8bd`): primary copy and secondary/label copy respectively.

### State
- **Error** (`#d1495b`, background tint `rgba(209,73,91,0.14)`): failed-payment digit tint (`.counter.is-failed`) and error form messages. Never used decoratively.

### Named Rules
**The Amber-Is-Verb Rule.** Amber only ever marks something happening or something the visitor can act on right now (hover, focus, active, loading, confirmed). If a use of amber isn't tied to an interaction or a live state, it doesn't belong.

## Typography

**Display Font:** Big Shoulders Display (with IBM Plex Sans, sans-serif fallback)
**Body Font:** IBM Plex Sans (with system sans-serif fallback)
**Label/Mono Font:** Space Mono (digits and currency only)

**Character:** A condensed, stenciled industrial display face paired with a neutral technical body sans and a monospace reserved strictly for measurement — the pairing reads as instrument-panel, not editorial.

### Hierarchy
- **Display** (800, 1.9rem, uppercase, 0.01em tracking): page `h1` only — "Apoie este projeto" / status headings.
- **Body** (400, 0.92–1rem, 1.5 line-height): subtitle copy and status messages, capped ~34ch.
- **Label** (600, 0.78–0.8rem, uppercase, 0.04–0.06em tracking): form labels, divider text, button text.
- **Data** (700, 1–2.75rem, tabular-nums, -0.02em tracking): counter digits, currency prefix, input amount field. Space Mono only.

### Named Rules
**The Monospace-Is-Measurement Rule.** Space Mono renders only digits and currency figures (the counter, the amount input, the currency prefix). It is never used for prose, labels, or dividers — a divider label was moved off Space Mono during finish review specifically because "monospace as a costume for technical" is a rejected pattern here.

## Layout

Single-column, mobile-first, centered inside `main.panel` capped at `max-width: 440px` with no fixed-pixel breakpoints above that. The counter, heading, actions, and footer stack vertically with a consistent rhythm (`0.4rem`–`1.75rem` gaps, `2.5rem` top padding on `body`). One responsive step, `@media (max-width: 380px)`, only rescales the counter's internal padding and digit/currency font sizes — it never restructures the page.

## Elevation & Depth

Flat structural surfaces (buttons, inputs, dividers) with a single soft, ambient shadow reserved for the counter housing — depth here reads as a physical object sitting slightly recessed into the panel, not a UI card floating above a background.

### Shadow Vocabulary
- **Panel shadow** (`box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset, 0 3px 6px rgba(0,0,0,0.45)`): the counter housing only — an inset highlight plus a soft, moderate-blur drop shadow suggesting a recessed brushed-metal panel.

### Named Rules
**The Earned-Shadow Rule.** Only the counter housing carries a shadow, and it is soft/ambient, never a zero-blur hard offset. A hard-offset "neobrutalist" shadow was explicitly rejected during finish review as a costume this gunmetal/brass world never earned.

## Shapes

Modest, consistent rounding (`6px` base radius on the counter, buttons, and inputs; `3px` on digit cells and rivets' visual weight) — never sharp/brutalist, never pill-shaped. Borders are thin (`1px`–`1.5px`) brass or brass-dim rules, used structurally (dividers, input/button outlines, counter bezel) rather than decoratively. The counter's four corner rivets (two via `::before`/`::after`, two via `.rivet-bl`/`.rivet-br` child spans) are the system's one recurring ornamental detail, and they appear only on the counter.

## Components

### Buttons
- **Shape:** 6px radius (`--radius`).
- **Primary:** transparent background, `1.5px` brass border, brass-light uppercase label text, full width, `0.75rem 1rem` padding.
- **Hover / Focus:** fills amber, border turns amber, text turns near-black (`#201703`); focus-visible adds a `3px` amber glow ring (`rgba(226,162,60,0.3)`).
- **Active:** 1px downward press (`translateY(1px)`).
- **Loading:** label text goes transparent and is replaced by a border-based spinner (amber accent ring, muted track) — the label is never simply disabled-and-silent.
- **Disabled:** border and text desaturate to the muted steel tone (`metal-highlight-soft` / `text-muted`).

### Inputs / Fields
- **Style:** dark panel background, `1px` brass-dim border, `6px` radius, Space Mono tabular digits; the currency prefix is a fused sibling box sharing the same border rhythm.
- **Focus:** border shifts to amber with a `3px` amber glow ring (`rgba(226,162,60,0.22)`), no layout shift.
- **Error:** validation messages render as a separate `.form-message.is-error` block (error-red text on tinted error background), not an input border-color change.

### Signature Component: The Counter (`.counter`)
The mechanical digit-wheel readout that opens every page before any copy. Full width of its container — never a small floating object — with a brushed-metal linear-gradient background blended with a CSS-only feTurbulence grain texture (`background-blend-mode: overlay`, no image asset), a `1px` brass-dim bezel, four corner rivets, and the soft panel shadow described above. Digits are Space Mono tabular-nums. Two states are exclusive to this component: `.is-confirmed` (all digits click together once, `digit-confirm`, applied exactly at payment confirmation — never a fade) and `.is-failed` (digits tint to the error red on the cancel page). A live per-digit `digit-tick` animation fires when a single digit changes while dialing in a custom amount.

## Do's and Don'ts

### Do:
- **Do** keep amber exclusive to actionable/live states (hover, focus, active, loading, confirmed digit-click) — never decorative fill.
- **Do** render every amount and digit in Space Mono tabular-nums; keep every other string in IBM Plex Sans or Big Shoulders Display.
- **Do** let the counter be the only card-like object in the system; new surfaces extend it rather than introducing a second container pattern.
- **Do** use the soft ambient panel shadow only on the counter housing, never elsewhere.

### Don't:
- **Don't** use a zero-blur hard-offset ("neobrutalist") shadow anywhere in this world — it was explicitly rejected during finish review as a costume this steel/brass identity never earned.
- **Don't** stand in a Unicode glyph (e.g. an arrow) for an icon; the back-link and any future navigational element communicate through color/underline shift alone.
- **Don't** introduce kicker/eyebrow labels above headings; none exist in the shipped build and none should be added.
- **Don't** use Space Mono for prose, labels, or dividers — it is reserved for digits and currency only.
