# Fortuna — brand identity

Fortuna is a private financial operating system for one person: banking, transactions, budgets, recurring payments, forecasting, investments, assets, liabilities and net worth in a single instrument.

The name carries both senses of fortune — accumulated wealth, and the classical figure of changing circumstance. The identity takes the second sense literally but quietly: circumstances turn, so the product's job is to keep one person's position accurate and calm while they do. Nothing in the system celebrates. Everything reports.

## The mark

**The Crossbar F.** An F with its lower arm carried straight through the stem, the way European currency glyphs are barred — a letter and a monetary sign in one shape. The crossing sits at the optical centre and acts as a fulcrum: two arms, one balance point.

Drawn on a 66-unit grid at a constant 9-unit stroke, butt caps, all straight lines and no curves, so nothing softens at small sizes. Clear space equals 1.5 × stroke on all sides. Cleared for use down to 16 × 16 px; below 20 px use the symbol alone, as the wordmark needs 96 px of width.

## Contents

```
fortuna-brand/
  README.md                  this file
  guidelines/index.html      full brand guidelines (open in a browser, prints to PDF)
  logos/svg/                 symbol, wordmark, horizontal + stacked lockups, light/dark/mono
  logos/png/                 transparent PNG symbol exports, 64–512 px
  icons/                     app icon and favicon SVG
  icons/png/                 app icon 1024/512/192/180, favicon 48/32/16
  colors/fortuna-colors.json colour system with measured contrast ratios
  typography/typography.md   type specification and licensing
  tokens/fortuna-tokens.css  CSS custom properties, light + dark
  tokens/fortuna-tokens.json platform-agnostic token export
  mockups/                   dashboard, mobile, open graph card
  source/                    editable source of the guidelines document
```

## Colour, in one paragraph

One brand hue: **Azure #0018A8**, lightened to **#6C9BFF** in dark theme. One accent, **Electric #0A50D0**, reserved for the lit surfaces — the glow on a hero panel and the marker on a gauge ring. Two grounds that never flip with the theme: **Navy #08112E** for the navigation rail and **#04091F → #10328A** for a hero panel, both always dark, the way a bank app keeps its balance header dark above a white page. Neutrals are cool: **#F1F4FA** paper, **#0E1626** text. Gains and losses stay legible without shouting (**#0B7550** / **#B52318**); on the navy they lighten to **#3FC486** / **#FF6152** — never a pale red, which reads pink on blue. Full tokens in `tokens/`, measured contrast in `colors/`.

## Typography, in one paragraph

**Spectral** for the brand voice and screen titles, **Instrument Sans** for the interface and every financial figure with `font-variant-numeric: tabular-nums`, **IBM Plex Mono** for ledger detail only. All three are SIL OFL. No font files are included in this package; see `typography/typography.md` for sources and self-hosting.

## Using the tokens

```html
<link rel="stylesheet" href="tokens/fortuna-tokens.css">
```

```css
.net-worth {
  font: var(--fortuna-amount-display);
  font-variant-numeric: var(--fortuna-numeric);
  color: var(--fortuna-text);
}
.delta-positive { color: var(--fortuna-positive); }
```

Dark theme: set `data-theme="dark"` on `<html>`, or rely on `prefers-color-scheme`.

## Favicon and app icon install

```html
<link rel="icon" href="icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="icons/png/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="icons/png/fortuna-app-icon-180.png">
```

macOS: use `icons/png/fortuna-app-icon-1024.png` as the source for `iconutil`. iOS: 1024 px, no transparency, no pre-applied corner radius is needed beyond the supplied 22.6% squircle approximation — the square variant `fortuna-app-icon-square-1024.png` is provided for platforms that mask their own shape.

## Usage in short

Do keep the symbol on a solid azure, navy or paper ground; use tabular figures in every column; separate regions with a 1 px border before reaching for elevation. Glow and gradient belong to the always-dark surfaces only — the hero panel and the navigation rail — where they carry the brand; a subtree drawn on them takes the `on-navy` token scope rather than a hand-picked colour.

Don't add a second accent hue, put a glow on a page card, a table or a chart, saturate gains and losses, set amounts in the mono face at display sizes, or place the symbol inside another container shape. A gauge ring is never decorative: a partly filled ring reads as a measurement, so it may only show a ratio the product actually computed, with the ratio named beside it.

Version 1.0 — September 2026.
