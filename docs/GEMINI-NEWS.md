# Gemini translation for newly published news

This is a targeted addition to the existing synchronizer. The design, RTL, language picker, scoring, canonical tracker records, source URLs, API Anything discovery and Pages permissions remain unchanged.

## Provider and credentials

- Official JavaScript SDK: `@google/genai` **3.6.1**, pinned in the isolated `automation/package-lock.json` (Node 22).
- Default model: **gemini-3.6-flash**, configurable with the `GEMINI_MODEL` environment variable/repository variable.
- The only credential input is `GEMINI_API_KEY`, supplied as a GitHub Actions Secret to the server-side content job and explicitly dispatched smoke check. Never add it to Pages, frontend configuration or repository files.
- The owner confirmed a fresh unexposed key on a Free-tier project with billing disabled. No billing/account settings were changed. The reachable Git history was scanned for the Google API-key pattern; no matches were found. Pattern scanning cannot prove the absence of every possible credential format or exposure elsewhere.

Google documents the selected stable Flash model, structured output support and free input/output allowance: [model](https://aistudio.google.com/docs/models/gemini-3.6-flash), [pricing](https://aistudio.google.com/docs/pricing#gemini-3.6-flash), [SDK](https://googleapis.github.io/js-genai/release_docs/), [structured output](https://aistudio.google.com/docs/structured-output). Free quotas and availability depend on the project and may change. This code never enables paid billing or falls back to a different paid model.

## Exact scope

`automation/state/news-translations.json` records activation time and all existing article/feed IDs as excluded. Historical records remain excluded even when edited or reintroduced. A previously unseen article published before the activation day is excluded; feed items with precise timestamps must be published after activation. Articles carrying only a calendar date are considered new when first discovered after activation on that day or later. Eligible newly published articles remain eligible for subsequent edits.

Only article title, `dek`/summary and body paragraphs, and newly published external news-feed titles reach Gemini. Source URLs accompany the request only as immutable references. Existing reviewed fields are omitted. Existing interface/project/tool/watchlist content and the old pending queue never go to Gemini. Their previous translation provider is unchanged.

English records stay canonical. Arabic is stored in **assets/i18n/news/ar.json**, indexed by stable news ID and field, with the exact original source text. Frontend lookups are restricted to news cards, feed headlines, dialogs, archive cards and generated article text/metadata. Identical text in a project description cannot pick up a Gemini translation. Human-reviewed translations take precedence. Exact source matching prevents changed English from displaying stale Arabic.

## Requests, cache and validation

One structured request handles all untranslated/changed fields in an article. Unchanged reviewed or translated fields are not sent again. A persistent source-hash cache can reuse an identical news field in another eligible news article. Both cache and retry state live in Git, surviving runner restarts. The public catalog contains no credentials or SDK configuration.

The full supplied Arabic newsroom instructions and terminology glossary are in `automation/lib/gemini-news.mjs`. The model treats article text as untrusted data, has no tools or executable output, and must return separate title, summary, indexed body paragraphs and exact source URLs. Protected tokens retain names, identifiers, numbers, URLs and placeholders. Validation rejects missing/extra fields, incomplete paragraphs, empty/non-Arabic text, changed numbers/references/tokens, HTML, executable protocols, changed Markdown structure and detectable changes to negation/uncertainty. These checks and the prompt reduce factual drift; they cannot mathematically prove semantic equivalence or guarantee flawless prose for every future article.

Only a successful validated result is published automatically. Failed changed fields use English while unchanged Arabic remains available. No article or canonical update is discarded because translation fails. Persistent pending items retry after backoff; auth/model errors wait a day, rate/quota errors at least an hour, and other failures use exponential delay capped at one day. A run attempts at most two requests for one article and respects a shared per-run budget. Raw SDK errors are never logged or stored: fixed safe error categories replace them.

## Limits and monitoring

Defaults (all bounded server-side environment variables):

| Variable | Default |
|---|---:|
| GEMINI_NEWS_MAX_REQUESTS | 3 requests/run |
| GEMINI_NEWS_DAILY_REQUESTS | 20 requests/UTC day |
| GEMINI_NEWS_DAILY_TOKENS | 100000 accounted tokens/UTC day |
| GEMINI_NEWS_MAX_INPUT_BYTES | 24000 bytes including prompt |
| GEMINI_NEWS_MAX_OUTPUT_TOKENS | 8192 |

The SDK's hidden retries and automatic continuation are disabled so request counts include every generation attempt. A conservative byte-based input reservation plus the output cap is charged against the daily token budget before each attempt. When usage metadata is available it replaces the reservation; failed requests without usage retain it conservatively. These application limits are not a Google billing cap. Keep billing disabled unless explicitly approving future spend. The smoke-check workflow is manual-only and has a separate allowance of at most two generation attempts for one synthetic article. The explicit supported `v1beta` Developer API is used; the SDK's default stable endpoint returned service errors during initial checks.

`content-sync-status`/`deployment-verification` artifacts include a `newsTranslation` section: requests, prompt/output/thinking tokens, duration, successful/failed translations, cached fields, pending news and safe error codes. The existing five-minute content schedule and 60-second visible-page data checks are unchanged. Arabic translation arrives after the next successful server sync and Pages deployment; the browser never calls Gemini. CDN caching and GitHub scheduler delays still apply.

Arabic pages also check the deployed news catalog every 60 seconds while visible, with failure backoff. A newly completed translation therefore replaces an English fallback even when the official tracker itself has not changed. Open readers and input controls postpone refresh; homepage filter/sort/scroll state is retained. The same catalog check works on static news articles and the archive. Its shortened 500-ms browser fixture verifies this English-to-Arabic replacement without altering production timing.

## Testing and operation

Run `node --test tests/*.test.mjs`. Routine tests inject mocked Gemini responses and require no key. `automation/gemini-news-browser.mjs _site` checks scoped cards/feed/dialog/article/archive rendering, unchanged project text, English, RTL and source links at desktop/mobile sizes using synthetic browser-only fixtures. Existing full browser tests now account for the already-supported English fallback and identify the actual project rather than assuming a fixed leader.

The manual `Gemini news API check` workflow sends one synthetic, unpublished news item through the real SDK, validates it with a bounded retry, and uploads safe example/latency/token metadata. It does not translate an old article, alter the public catalog or manufacture a production story. A successful smoke check proves API/validation integration; translation of a genuine newly published story can only be verified once upstream publishes an eligible story.

Normal operation uses the existing `content-sync.yml`: validated news results and durable state are committed, and catalog changes explicitly dispatch the existing Pages workflow. The preview includes an additional scoped-news browser gate and checks the deployed news catalog. No upstream PR is opened.

Files added: `automation/lib/gemini-news.mjs`, `news-sync.mjs`, `gemini-news-smoke.mjs`, `gemini-news-browser.mjs`, `automation/state/news-translations.json`, `assets/i18n/news/ar.json`, `tests/gemini-news.test.mjs`, the manual smoke workflow and this report. Modified: content sync/preview workflows, isolated SDK lock/package files, content/news display helpers and news-only call sites, deployment asset verification and existing browser-test expectations.

Selection evidence: Gemini 3.8 returned generation HTTP 503 during real checks; 3.5 Flash-Lite produced responses rejected by the facts/language guard. Gemini 3.6 Flash returned a validated synthetic translation in 2031 ms (978 input, 195 output tokens); inspection then identified a duplicated Arabic verb, so a fluency rejection rule and regression were added before final acceptance. No synthetic story was published.

## Real API result and remaining limits

The final fluency-guarded [real API check succeeded](https://github.com/General-c4/portwatch-vi/actions/runs/45672323154) using **gemini-3.6-flash** in one generation request: **27932 ms**, **1019 input tokens**, **143 output tokens**, **1162 total tokens**. No separate thinking-token count was reported. This is the final measured request duration; the earlier 2031-ms result is not a latency guarantee. On the owner's confirmed unbilled Free-tier project the estimated charge is **$0**. At the documented November 2026 standard paid rates ($0.75 input/$3.75 output per million), the same final request would be approximately **$0.0013005**; paid billing was not enabled.

Synthetic source headline: `Leonida Reforge reports 12.5 fps in an unverified test`.

Validated Arabic: `مشروع Leonida Reforge يسجل 12.5 fps في اختبار غير مؤكد`.

Synthetic source paragraph: `The developers say rendering may improve. This is an unverified claim, not an independent benchmark.`

Validated Arabic: `صرح المطورون بأن التصيير الرسومي قد يتحسن. يُعد هذا ادعاءً غير مؤكد وليس اختبار أداء مستقلًا.`

All 24 Node tests, 141 existing full-browser cases, five private-dashboard viewport checks, the malicious-catalog isolation check, and the new scoped-news desktop/mobile browser fixture passed. Reviewed dictionaries remain byte-for-byte unchanged in content: 366 interface entries, 601 editorial entries and 79 dashboard entries. A missing Git identity was discovered when the existing source synchronizer first staged an upstream merge on a clean runner; its merge command now explicitly supplies the same bot identity as its commit commands, and the source workflow subsequently succeeded.

No genuinely new eligible upstream story was available during acceptance, so no historical story or the old pending queue was translated for demonstration. Live deployment verifies the new catalog and UI; the first production article translation remains contingent on an eligible upstream publication. Free-tier 503 responses occurred during checks; bounded retries, a persistent queue and English fallback handle recurrence. Prompting and validation are safeguards, not proof that every future translation is semantically or grammatically perfect.
