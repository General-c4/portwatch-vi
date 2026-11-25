# Gemini translation for newly published news

This is a targeted addition to the existing synchronizer. The design, RTL, language picker, scoring, canonical tracker records, source URLs, API Anything discovery and Pages permissions remain unchanged.

## Provider and credentials

- Official JavaScript SDK: `@google/genai` **3.6.1**, pinned in the isolated `automation/package-lock.json` (Node 22).
- Default model: **gemini-3.8-flash**, configurable with the `GEMINI_MODEL` environment variable/repository variable.
- The only credential input is `GEMINI_API_KEY`, supplied as a GitHub Actions Secret to the server-side content job and explicitly dispatched smoke check. Never add it to Pages, frontend configuration or repository files.
- The owner confirmed a fresh unexposed key on a Free-tier project with billing disabled. No billing/account settings were changed. The reachable Git history was scanned for the Google API-key pattern; no matches were found. Pattern scanning cannot prove the absence of every possible credential format or exposure elsewhere.

Google documents the selected stable Flash model, structured output support and free input/output allowance: [model](https://aistudio.google.com/docs/models/gemini-3.8-flash), [pricing](https://aistudio.google.com/docs/pricing#gemini-3.8-flash), [SDK](https://googleapis.github.io/js-genai/release_docs/), [structured output](https://aistudio.google.com/docs/structured-output). Free quotas and availability depend on the project and may change. This code never enables paid billing or falls back to a different paid model.

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

The SDK's hidden retries are disabled so request counts include every generation attempt. A conservative byte-based input reservation plus the output cap is charged against the daily token budget before each attempt. When usage metadata is available it replaces the reservation; failed requests without usage retain it conservatively. These application limits are not a Google billing cap. Keep billing disabled unless explicitly approving future spend. The smoke-check workflow is manual-only and has a separate, single-request allowance.

`content-sync-status`/`deployment-verification` artifacts include a `newsTranslation` section: requests, prompt/output/thinking tokens, duration, successful/failed translations, cached fields, pending news and safe error codes. The existing five-minute content schedule and 60-second visible-page data checks are unchanged. Arabic translation arrives after the next successful server sync and Pages deployment; the browser never calls Gemini. CDN caching and GitHub scheduler delays still apply.

## Testing and operation

Run `node --test tests/*.test.mjs`. Routine tests inject mocked Gemini responses and require no key. `automation/gemini-news-browser.mjs _site` checks scoped cards/feed/dialog/article/archive rendering, unchanged project text, English, RTL and source links at desktop/mobile sizes using synthetic browser-only fixtures. Existing full browser tests now account for the already-supported English fallback and identify the actual project rather than assuming a fixed leader.

The manual `Gemini news API check` workflow sends one synthetic, unpublished news item through the real SDK, validates it, and uploads safe example/latency/token metadata. It does not translate an old article, alter the public catalog or manufacture a production story. A successful smoke check proves API/validation integration; translation of a genuine newly published story can only be verified once upstream publishes an eligible story.

Normal operation uses the existing `content-sync.yml`: validated news results and durable state are committed, and catalog changes explicitly dispatch the existing Pages workflow. The preview includes an additional scoped-news browser gate and checks the deployed news catalog. No upstream PR is opened.

Files added: `automation/lib/gemini-news.mjs`, `news-sync.mjs`, `gemini-news-smoke.mjs`, `gemini-news-browser.mjs`, `automation/state/news-translations.json`, `assets/i18n/news/ar.json`, `tests/gemini-news.test.mjs`, the manual smoke workflow and this report. Modified: content sync/preview workflows, isolated SDK lock/package files, content/news display helpers and news-only call sites, deployment asset verification and existing browser-test expectations.
