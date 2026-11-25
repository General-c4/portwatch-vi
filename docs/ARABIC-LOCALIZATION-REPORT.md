# Arabic localization delivery report

Prepared 25 November 2026. Baseline: official `4lwayz/portwatch-vi` commit `bc768b4b1b0c45b526a6404adb083c6004be9e5b`. Tracker snapshot: `2026-11-25T10:45:44.000Z`. The official repository still served the same tracker at preview verification.

## Implementation

Arabic (`ar`, العربية) is available through the existing language picker, saved preference, and regional browser detection. Arabic applies `lang=ar` and `dir=rtl`; selecting another language restores LTR. The original reload-based selection behavior is preserved.

The interface catalog covers the English fallback and Portuguese template, including milestone, groundwork, stability and scoring explanations. Arabic plural categories cover zero, one, two, few, many and other, including relative time and visible counts. Existing placeholders are preserved. Arabic uses Segoe UI/Tahoma/Arial; other languages retain Inter.

Logical CSS properties cover navigation, menus, cards, table alignment, notes and footer. Arabic headings have connected script spacing and sufficient line height. Names, repositories, numeric values and substitutions use bidi isolation. Directional arrows follow RTL. Measured progress coordinates, history charts, logos, photographs, non-directional SVGs, colors and animations retain their original orientation. A clipped skip link avoids RTL overflow and remains focusable.

The separate editorial catalog provides all 23 article titles, summaries and bodies; 37 project summaries and technical notes; 22 toolkit descriptions; candidate descriptions; headlines; change-feed text; source-title translations; and the current pinned message. Exact English source matching prevents stale Arabic from replacing changed claims. Newly added or changed content falls back to English until translated. Text is escaped or assigned through `textContent`; identifiers and navigation URLs are not passed through editorial translation. A malicious-catalog browser regression checks this boundary.

The private dashboard shares the picker and direction. Its UI, labels, states and fixed status messages are localized; editable text, posts and backend diagnostic details remain authoritative. Tests use mocked admin read responses and perform no moderation, authentication-email or publishing writes. The dashboard remains excluded from deployment.

The public board was removed upstream on 24 November. It has not been restored; all retained board translation keys are covered.

## Coverage

| Area | Coverage |
| --- | --- |
| Interface template and fallback keys | 100% (303/303 required keys) |
| Arabic interface entries including extra plural forms | 365 |
| Current inventoried editorial fields | 100% (682/682) |
| Distinct editorial translation entries, including pinned text | 601 |
| Generated news articles | 23/23 titles, decks and bodies |

Project names, usernames, brands, programming-language names, URLs, machine enums, credits and source evidence fragments are intentionally preserved. This coverage is for the stated snapshot; future scout updates can safely show English pending editorial translation. [The maintenance guide](../assets/i18n/ARABIC.md) documents the workflow, inventory exclusions and checks.

## Local browser and functional checks

Microsoft Edge through Playwright on Windows was used at 1920×1080, 2560×1440, 768×1024, 390×844 and 360×800.

- 141 public browser cases passed: 20 homepage language/size combinations; the news archive and all 23 articles at all five sizes; and combined real-picker switching, refresh persistence and failed-catalog fallback checks.
- Scores and ranking order matched English in all four languages. All filter modes and sort choices were exercised.
- News reader opening/Escape closing and language-menu ArrowDown/Escape focus return were exercised. No unwanted document horizontal scrolling was found.
- Article bodies matched their Arabic catalog paragraphs; canonical article URLs remained the original URLs.
- Five private dashboard sizes passed with mocked admin read responses; no overflow or uncaught JavaScript exceptions.
- Six Node tests passed for interface coverage/placeholders, regional detection, plural forms/direction, editorial coverage, canonical-data/score invariants and fallback handling.
- The malicious-catalog browser regression passed: HTML stayed literal text, no code executed, and repository identifiers/links remained canonical.
- JavaScript syntax checks and `git diff --check` passed. The original project supplied no test or lint script; the new checks are reproducible without adding production dependencies.

Raw results: [public browser checks](verification/browser-results.json), [dashboard checks](verification/dashboard-results.json), [deployed checks](verification/deployed-results.json).

## LTR visual regression check

Fifteen comparisons against the unmodified upstream checkout passed: English, Portuguese and Spanish at all five sizes. Hero, overall-progress panel, first leaderboard card, news, watchlist, toolkit, scoring and footer rectangles matched exactly after disabling motion for measurement. [Geometry results](verification/ltr-layout-results.json) are included. Final Arabic checks also verified progress-label non-overlap, numeric-ratio isolation and absence of unresolved placeholders at all five sizes.

## Console and resources

Public local checks recorded **zero uncaught JavaScript exceptions** and **zero unexpected local resource failures**. Console logging recorded one HTTP 429 from an existing external GitHub OpenGraph article image during repeated requests; the existing cover fallback handled it. Two HTTP 404 console messages were deliberately produced by the missing-catalog fallback tests. No source links or images were substituted to hide these results.

The deployed preview verification recorded **zero console errors** and **zero uncaught JavaScript exceptions**. Authenticated admin actions, every external third-party destination, Firefox and Safari were not tested.

## Visual evidence

Original English screenshots were captured before modifications. Matching full-page comparisons were also captured against a separate archive of the unmodified upstream commit, with folded sections expanded for inspection. Arabic screenshots include the complete page. Different text wrapping and Arabic line-height are intentional.

| Viewport | Original English | Arabic RTL |
| --- | --- | --- |
| 1920×1080 | [Before](screenshots/before-en-1920.png) | [After](screenshots/after-ar-1920.png) |
| 2560×1440 | [Before](screenshots/before-en-2560.png) | [After](screenshots/after-ar-2560.png) |
| 768×1024 | [Before](screenshots/before-en-768.png) | [After](screenshots/after-ar-768.png) |
| 390×844 | [Before](screenshots/before-en-390.png) | [After](screenshots/after-ar-390.png) |
| 360×800 | [Before](screenshots/before-en-360.png) | [After](screenshots/after-ar-360.png) |

Quick comparisons: [desktop](screenshots/comparison-desktop.png), [tablet](screenshots/comparison-tablet.png), [mobile](screenshots/comparison-mobile.png). Full-size captures and additional language/article/dashboard screenshots are also retained in the local `.local-qa/screenshots/` directory.

## Pipeline and deployment

`data/tracker.json`, `data/pinned.json`, scoring algorithms, scout code, the existing GitHub Actions files, API integrations and original domain are unchanged. Existing builds still copy `assets/` and generate the same canonical news paths, RSS and sitemap. The only shared site-generator change loads the news localization enhancement.

The fork-only preview workflow deploys the feature branch and follows the official scout's tracker/pinned output every three hours. It does not run another scout or ping IndexNow. Preview output disables production analytics and indexing, and defaults first-time preview visitors to Arabic while respecting saved choices. The upstream deployment and analytics behavior are unaffected. The fork's inherited Scout/Deploy workflows are disabled in its GitHub settings to avoid duplicate automation; their source files remain unchanged. Its Pages environment explicitly allows this feature branch.

- [Fork](https://github.com/General-c4/portwatch-vi)
- [Working branch](https://github.com/General-c4/portwatch-vi/tree/feat/arabic-rtl-localization)
- [Deployed preview](https://general-c4.github.io/portwatch-vi/)
- [Review diff](https://github.com/4lwayz/portwatch-vi/compare/main...General-c4:portwatch-vi:feat/arabic-rtl-localization)

Deployed verification passed all five viewport sizes, Arabic first visit, switching to English and back, news-dialog interaction, the expected leading score, and 26 HTTP checks covering every article, archive and translation catalogs. The first deployment was blocked by the fork's default main-only environment rule; after adding the feature branch, a Pages service failure required a retry. Subsequent deployments succeeded.

No upstream PR has been submitted. [The prepared PR description](PULL_REQUEST.md) is ready for review; submission requires the user's approval, as requested.

## Changed files

- `assets/i18n/ar.json`, `en.json`, `content/ar.json`, `dashboard/ar.json`, `README.md`, `ARABIC.md`: interface/editorial/private catalogs and maintenance documentation.
- `assets/js/i18n.js`, `content-i18n.js`, `news-i18n.js`, `app.js`: language detection, direction, plurals, safe content lookup and generated-page enhancement.
- `assets/css/style.css`, `index.html`: logical layout, Arabic typography, isolation, accessible skip link and metadata hooks.
- `dashboard/index.html`, `i18n.js`, `dashboard.css`, `pinned-editor.css`: private dashboard localization and responsive RTL.
- `scripts/lib/site-build.mjs`, `content-coverage.mjs`, `scripts/check-localization.mjs`, `scripts/preview-build.mjs`: enhancement inclusion, coverage inventory and isolated preview build.
- `tests/i18n.test.mjs`, `content-i18n.test.mjs`, `browser.mjs`, `dashboard-browser.mjs`, `security-browser.mjs`: meaningful unit/browser regressions.
- `.github/workflows/arabic-preview.yml`: fork-only preview automation. `.gitignore`: excludes local QA work.
- `docs/ARABIC-LOCALIZATION-REPORT.md`, `PULL_REQUEST.md`, `screenshots/`, `verification/`: delivery evidence and contribution preparation.

## Remaining limits

New or edited editorial text requires human-reviewed Arabic entries; no paid or automatic translation API was introduced. Generated Arabic articles require JavaScript, while canonical English remains crawlable without it. The browser checks establish behavior on the tested Edge/Windows environment and do not constitute a cross-browser accessibility certification. Existing third-party image hosts can rate-limit or remove their images; the original fallback remains in place.
