# Arabic localization

The homepage, generated news archive and every article share the existing picker and `pw-lang` preference. `ar` and regional browser locales such as `ar-SA` and `ar-AE` select Arabic. The private local dashboard also shares that preference. The removed public board is not restored; its retained interface keys are translated for compatibility.

## Interface and direction

`ar.json` covers the `pt-BR.json` template and `en.json` fallback, including scoring labels whose English lives in `scoring.js`. Values remain plain text. Keep existing placeholders such as `{n}`, `{ago}`, and `{name}` unchanged. Never put HTML in a translation.

Arabic sets `html[lang=ar][dir=rtl]`; other languages restore `dir=ltr`. Arabic uses the installed Segoe UI/Tahoma/Arial stack, leaving Inter for other languages. Logical margins, padding, alignment and menu positions follow the direction. Arabic headings use connected script spacing and sufficient line height. Brands, usernames, numerical scores and countdown digits are isolated. Placeholder substitutions use Unicode first-strong isolates.

The measured progress scale and history chart retain their original left-to-right coordinates. Arabic labels remain readable and the existing label collision layout still applies. Gradients, logos, photographs, SVG icons and animations retain their orientation.

`tn()` uses `Intl.PluralRules('ar')` for zero, one, two, few, many and other. Count-bearing `t()` calls also select Arabic variants when present, including relative time, project/tool counts, viewers and commit counts. English, Spanish and Portuguese rules remain unchanged.

## Editorial content

`content/ar.json` maps **complete, exact English source text** to Arabic. The original `data/tracker.json` and `data/pinned.json` remain authoritative. The scout, scores, ranking, timestamps, evidence, URLs, article ids and source links are never rewritten. The homepage escapes translated content before rendering. Generated articles replace existing English text nodes using `textContent`; their English HTML, RSS, structured data, sitemap and canonical URLs remain available without JavaScript.

Each unique source string is translated once. If a source paragraph changes, its previous key no longer matches, so the new English paragraph is shown until reviewed. Missing or failed catalogs fall back to English. The fixed scout sentence `Scout spotted owner/repo (possible effort, substance N).` has an anchored grammar translation retaining its repository and number. No translation service or new runtime dependency is used.

To translate an update:

1. Pull the latest tracker data and run `node scripts/check-localization.mjs`.
2. Copy each reported field's entire English value as a new key in `content/ar.json`. Translate into Modern Standard Arabic. Preserve names, identifiers, quantities, claim qualifications, paragraph boundaries and source attribution. Do not correct historical claims during translation.
3. For a pinned-message update, add the exact complete text, including newlines, to the same catalog. The editor's canonical text field is deliberately preserved.
4. Remove obsolete entries only after checking that other projects/articles do not use them. Run checks and inspect screenshots.

`scripts/lib/content-coverage.mjs` inventories editorial fields. URLs, author/outlet credits, project names, code languages and machine enums are excluded. The check is informational by default: an untranslated scout update must not stop updates. `--strict` checks a complete translation snapshot. `dashboard/ar.json` contains private dashboard UI text; user-authored posts and editable pinned text remain unchanged.

## Verification

```sh
node --test tests/*.test.mjs
node scripts/check-localization.mjs --strict
node scripts/preview-build.mjs
python -m http.server 8080 --directory _site
```

Optional browser checks use `npm install --no-save --package-lock=false playwright`. With Edge installed, set `PW_BASE_URL=http://127.0.0.1:8080/` and run `node tests/browser.mjs`. Alternatively set `PW_BROWSER=chromium` after `npx playwright install chromium`. The suite checks four languages at five sizes, filters, sorting, scores/ranks, dialog/picker keyboard handling, preferences, catalog fallback, and all Arabic articles. Screenshots/results go to `.local-qa/`. `PW_BASELINE_URL` captures matching unmodified views. Authenticated moderation/publishing are not exercised.

## Fork preview

`.github/workflows/arabic-preview.yml` is restricted to forks and the feature branch. It builds without scout execution or IndexNow pings, disables production analytics **in preview output only**, and deploys to the fork's GitHub Pages. A three-hour schedule reads the original scout's current `tracker.json` and `pinned.json` from the official repository into preview output; new or changed text falls back to English pending translation. It never changes the upstream domain, canonical repository data or existing workflows. The private dashboard is not deployed, as before. Upstream deployment keeps `scripts/build-site.mjs` and copies the catalogs through its existing `assets/` step.
