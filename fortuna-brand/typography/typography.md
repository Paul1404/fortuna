# Fortuna — typography specification

## Families

| Role | Typeface | Licence | Source |
| --- | --- | --- | --- |
| Display / brand voice | **Spectral** (300, 400, 500, 300 italic) | SIL Open Font License 1.1 | fonts.google.com/specimen/Spectral — Production Type |
| Primary UI + all figures | **Instrument Sans** (400, 500, 600) | SIL Open Font License 1.1 | fonts.google.com/specimen/Instrument+Sans |
| Ledger detail | **IBM Plex Mono** (400, 500) | SIL Open Font License 1.1 | fonts.google.com/specimen/IBM+Plex+Mono |

No font binaries are included in this package. All three are free for commercial use, self-hostable, and redistributable under the OFL. Self-host via fontsource (`@fontsource/spectral`, `@fontsource/instrument-sans`, `@fontsource/ibm-plex-mono`) rather than the Google CDN for a privacy-first product.

Fallback stacks:

```
--fortuna-font-display: "Spectral", Georgia, "Times New Roman", serif;
--fortuna-font-sans: "Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
--fortuna-font-mono: "IBM Plex Mono", ui-monospace, "SF Mono", monospace;
```

## Scale

| Token | Spec | Use |
| --- | --- | --- |
| display | Spectral 300 / 44 / 1.1 / -1.5% | Screen titles, hero net worth in marketing |
| title | Spectral 400 / 30 / 1.2 / -1% | Section titles, brand copy |
| h1 | Instrument Sans 600 / 20 / 1.3 | Page headers in product |
| h2 | Instrument Sans 600 / 15 / 1.4 | Card headers |
| body | Instrument Sans 400 / 14 / 1.7 | Paragraphs, analysis text |
| caption | Instrument Sans 400 / 12 / 1.5 | Metadata, dates, helper text |
| label | Instrument Sans 500 / 11 / 0.13em / uppercase | Tile labels, table heads |
| mono | IBM Plex Mono 400 / 12 | IBAN, references, IDs, token names |

## Figures

Amounts are set in Instrument Sans, never in the mono or display face.

```css
.amount { font-variant-numeric: tabular-nums lining-nums; letter-spacing: -0.015em; }
```

| Context | Spec |
| --- | --- |
| Hero amount | 600 / 56 / -2% — `€126,483.17` |
| Tile amount | 600 / 23 / -1.5% — `€126,483` |
| Row amount | 600 / 13.5 — `−€781.49` |
| Delta | 600 / 12–14, positive/negative token colour — `+€4,285.32` |
| Percentage | same weight as its amount, one decimal — `37.4%` |

Rules:

1. Tabular figures for anything in a column. Proportional figures are permitted only in running prose.
2. Minus sign is U+2212 (`−`), never a hyphen. Plus sign only on gains.
3. Currency symbol precedes the amount. Minor units appear in ledgers and detail views; summary tiles drop them above €10,000.
4. Grouping follows the user's locale: `€126,483.17` (en) and `€126.483,17` (de). Never mix conventions on one screen.
5. Amounts never wrap. Truncate the label, never the number.
6. Blurred-privacy mode replaces digits with `•` at the same tabular width so layout does not shift.
