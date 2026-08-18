# Fonts vendored for motivation documents

Every family here is redistributable and shipped WITH its licence text, which the
SIL Open Font License requires. They are vendored rather than fetched because the
production box builds offline and because a document must render identically in
two years' time.

They exist to make each motivation look like a different person's document.
Structural variation was already in place; this is the visual half. Every face
was chosen to read as an ORDINARY BUSINESS DOCUMENT — the sort of thing someone
types at home — because a motivation that looks professionally typeset stands out
just as badly as one that looks mass-produced. Several are metric-compatible
substitutes for the fonts people actually have in Word.

| Family | Licence | Reads like | Source |
|---|---|---|---|
| Carlito | OFL 1.1 | Calibri (metric-compatible) | google/fonts `ofl/carlito` |
| Caladea | OFL 1.1 | Cambria (metric-compatible) | google/fonts `ofl/caladea` |
| PT Serif | OFL 1.1 | a plain book serif | google/fonts `ofl/ptserif` |
| PT Sans | OFL 1.1 | a plain humanist sans | google/fonts `ofl/ptsans` |
| Lato | OFL 1.1 | a neutral office sans | google/fonts `ofl/lato` |
| Crimson Text | OFL 1.1 | Garamond-ish old style | google/fonts `ofl/crimsontext` |
| Spectral | OFL 1.1 | a screen-first serif | google/fonts `ofl/spectral` |
| Cardo | OFL 1.1 | a scholarly serif | google/fonts `ofl/cardo` |
| Gentium Plus | OFL 1.1 | a wide reading serif | google/fonts `ofl/gentiumplus` |
| Neuton | OFL 1.1 | a narrow economical serif | google/fonts `ofl/neuton` |
| Old Standard | OFL 1.1 | a period bookface | google/fonts `ofl/oldstandardtt` |

Licence texts are in `licenses/`.

**Tinos was fetched and then dropped.** Its METADATA.pb declares OFL but the
directory carries no `OFL.txt`, and shipping a font without the licence text it
requires is not something to do casually. Eleven families is already past the ten
the operator asked for.

Each family has Regular, Bold and Italic as REAL STATIC FILES. Variable fonts
(`Family[wght].ttf`) were deliberately avoided: pdfkit renders the default
instance and gives no way to select a weight axis, so every bold heading would
silently come out at regular weight — a failure that looks like nothing at all.

⚠️ These are resolved at runtime from `assets/`, the same defensive
candidate-path way `saps534.service.ts` finds its blank form. `nest-cli.json`
does NOT copy non-TS assets into `dist/`, so a naive `__dirname` path works in
development and 404s in production.
