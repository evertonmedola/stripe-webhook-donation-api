---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: ["public/success.html","public/cancel.html","public/style.css","public/checkout.js","public/status-poll.js"]
---

## Scope

Persuade surface: `public/index.html` (donation entry), with `public/success.html`,
`public/cancel.html`, `public/style.css`, `public/checkout.js`, `public/status-poll.js`
inheriting the same world. Visitor mode: Persuade (donor decides and acts; technical
evaluator judges craft).

## Audience, job, action, proof, constraints

Two audiences share one surface: a donor completing a real Stripe test-mode checkout,
and a technical evaluator judging engineering/design rigor. Job: donate a fixed or
custom amount with zero doubt about where the money goes and what state the payment
is in. Action: pick fixed amount or type a custom one, submit, watch the payment
resolve. Proof: real Stripe integration, real state machine (pending/paid/failed/
refunded). Constraints: vanilla HTML/CSS/JS, no framework, no build step; footer
credit "Desenvolvido por Everton Medola" linking to
https://github.com/evertonmedola on every page; no invented org/company.

## Direction contract

**THESIS:** The donation amount is not displayed, it is counted — a mechanical
digit-wheel readout, not a card with a number in it. Refuses the soft-card/rounded-
button SaaS default entirely.

**OWN-WORLD:** Gunmetal (#2b2f33-ish cool steel) structure, dulled brass/bronze
fittings and rule lines, warm amber reserved strictly for actionable/live elements
(never decorative). Cool steel-gray ground (not warm cream, not near-black+neon —
both are ruts). Tabular monospace numerals (Space Mono / IBM Plex Mono) for every
amount and counter digit; Space Grotesk for headings/labels/body — an industrial,
technical voice, not a display serif.

**STORY:** Visitor sees a mechanical counter holding the donation amount before any
copy. They pick a fixed amount or dial in a custom one (counter digits roll to the
new value); submit; the counter's digits give one decisive final click exactly when
Stripe confirms payment, on the success page.

**FIRST VIEWPORT:** The counter housing (rendered in CSS/SVG — brushed-metal gradient,
rivets at the corners, a thin brass bezel) sits alone at the top, holding the current
amount in tabular digits. Below it: the fixed-amount action (brass-bordered button,
amber only on hover/focus) and the custom-amount dial input. No card-in-card, no
rounded soft shell — the counter housing IS the only "card."

**FORM:** Mechanical tally-counter / odometer, candidate 4 of 7 (turnstile, ledger,
guilloché, **tally-counter**, ticker, vault, receipt), seed key `6d0e49ab`. Named
raises carried from declined challengers:
- RAISE (warm-consumer-app): amber appears strictly on actionable elements, never as
  decoration or passive fill.
- RAISE (akari-light-sculpture): one decisive physical ritual — digit wheels perform
  a single synchronized final click exactly at payment confirmation, never a fade.
- RAISE (rain-night-cityscape): true material rendering — brushed-metal sheen/
  highlight gradients on the housing, not flat vector color.
- RAISE (risograph-web-system): tactile material commitment — faint metal grain and
  rivet/screw details on the housing, without borrowing ink misregistration or its
  color system.
- RAISE (pop-culture-vertical-feed): full-viewport commitment — the counter owns the
  first viewport decisively, nothing shares space with it.

Competitive alternate not built: teletext broadcast-terminal (monospace grid,
blinking status states) — held one axis (financial-data-world identification) but
risked responsive/legibility clarity against the assigned direction.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance.

## Unresolved decisions

- Exact digit-wheel roll animation easing/timing (decide during build).
- Whether the counter housing is pure CSS/gradients or an inline SVG (decide during
  build based on what best sells "physical object" at zero asset weight — no image
  generation available this session, so no raster plates).
