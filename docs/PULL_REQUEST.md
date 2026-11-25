# feat(i18n): add Arabic localization and full RTL support

PortWatch VI had no Arabic option, and its generated news pages bypassed interface localization. This adds العربية (`ar`) with regional locale detection, persisted selection, six-category Arabic pluralization and RTL layout while preserving the original tracker, scores, ranks, data pipeline and visual identity.

Arabic covers the complete interface template and fallback (303 required keys), plus all 682 inventoried editorial fields in the current tracker snapshot. A separate exact-source content catalog translates projects, news and change text; newly changed English falls back safely until its translation is reviewed. Generated news retains canonical URLs, English no-JS HTML, RSS and structured data. Translation values remain plain text and cannot rewrite identifiers or links. The private dashboard is localized without restoring the removed public board.

Core interface work and the editorial-content layer are separate commits. No runtime dependencies, translation services, canonical data/scoring changes or changes to the existing scout/deploy workflow files are included. A fork-only workflow provides the review preview; it never deploys to the upstream domain.

Validation: six Node tests; 141 public Playwright browser cases across four languages and five viewport sizes; five dashboard checks using read-only mocked admin responses; malicious-catalog rendering/link isolation; syntax and whitespace checks. The deployed preview was checked at all five sizes and all 23 article URLs returned HTTP 200. No uncaught JavaScript errors were observed. Repeated local testing encountered one existing external-image HTTP 429; missing-catalog tests intentionally produced two HTTP 404s.

- [Working preview](https://general-c4.github.io/portwatch-vi/)
- [Full implementation report and results](ARABIC-LOCALIZATION-REPORT.md)
- [Translation maintenance guide](../assets/i18n/ARABIC.md)
- [Desktop comparison](screenshots/comparison-desktop.png)
- [Tablet comparison](screenshots/comparison-tablet.png)
- [Mobile comparison](screenshots/comparison-mobile.png)

Remaining scope: new editorial text needs manual Arabic review; generated Arabic news is a JavaScript enhancement over canonical English HTML. Firefox/Safari and authenticated admin writes were not tested. This PR description is prepared locally; the upstream PR is intentionally not submitted until the preview is approved.
