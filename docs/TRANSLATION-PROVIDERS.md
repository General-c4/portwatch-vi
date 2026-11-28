# Free translation routing

The canonical tracker is downloaded and published independently of translation. Missing or rejected Arabic falls back to the current English text; a translation cache cannot restore old projects or scores. Reviewed translations remain authoritative. Historical article exclusions remain in place.

## Selection and cost boundary

`automation/translation-providers.json` configures order, primary, allowed model choice and conservative local budgets. Gemini remains primary. Other providers are ranked by configured order, observed failure rate and latency, plus an optional **human-measured** `reviewedArabicQuality` score. No quality benchmark is invented for an untested account. Quota exhaustion removes a provider until its cooldown expires.

Credentials alone do not enable authenticated providers. `TRANSLATION_FREE_PROVIDERS` must list accounts whose owner verified a free plan, no paid balance/automatic top-up and no enabled billing. Its default is `gemini`, already confirmed by the owner. Do not add a funded or billed account. The application cannot independently prove external account billing settings. AxForge's included allowance is a changeable launch offer, not an unconditional permanent entitlement.

The code permits only explicit models and fixed HTTPS endpoints, refuses HTTP redirects and never purchases credits, changes billing, or routes to a paid model. OpenRouter additionally checks live model input/output prices are zero and sets routing price ceilings to zero. OVH uses anonymous requests exclusively: it never sends credentials or switches to authenticated billing. If anonymous access ends, it fails closed. No tools, URL-fetching tools, browser execution or model-supplied executable code are used.

## Adapters and documented limits (checked 2026-11-28)

| Adapter | Default model | Free capacity and reset | Activation |
|---|---|---|---|
| Gemini | `gemini-3.6-flash` | Account-specific. This project's observed daily quota was 20 requests; daily reset is midnight Pacific, with DST respected. | Existing free project and secret |
| Groq | `qwen/qwen3.8-27b` | Official base free table: 30 RPM, 1,000 RPD, 8,000 TPM, 200,000 TPD. Response reset headers take precedence; a UTC local budget is an additional cap, not a claim about the provider window. | Free account assurance + secret |
| Cloudflare | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 10,000 neurons per day shared across models; 00:00 UTC reset. Workers Free rejects excess use. Token-equivalent capacity varies by model. | Workers Free assurance + token/account ID |
| OVH anonymous | `Qwen3.8-27B` | 2 RPM/IP/model; no daily/monthly token allowance published. Serial interval is 31 seconds. | No account or key |
| Z.AI | `glm-4.7-flash` | Input/output officially Free; numeric account quotas/reset are not published in the pricing document. | Free account assurance + secret |
| AxForge | `qwen3.8-27b` | Included 3M tokens/30 days, shared; launch offer can change. Official limit: 120 requests/minute/key/type; free concurrency 2 and shared model seats. | Unfunded, no-top-up free account assurance + secret |
| OpenRouter | `google/gemma-4-26b-a4b-it:free` | Conservative local cap 50/day; actual account quota must be read from account metadata. Zero live token pricing is required before inference. | Free account assurance + secret |

The application never treats an unknown quota as unlimited. All providers remain subject to their terms, capacity and model availability. A local day/month counter is not a provider invoice or authoritative remaining quota. The monthly AxForge cap resets conservatively 30 days after the application's first reservation, which can be later than the account allowance renewal.

Official sources:

- [Gemini rate limits](https://aistudio.google.com/docs/rate-limits), [API keys](https://aistudio.google.com/app/apikey).
- [Groq limits](https://console.groq.com/docs/rate-limits), [billing](https://console.groq.com/docs/billing-faqs), [API keys](https://console.groq.com/keys).
- [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [API tokens](https://dash.cloudflare.com/profile/api-tokens).
- [OVH capabilities and anonymous limits](https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-capabilities). Authenticated OVH usage is deliberately not implemented.
- [Z.AI pricing including free Flash variants](https://docs.z.ai/guides/overview/pricing.md), [API keys](https://z.ai/manage-apikey/apikey-list).
- [AxForge terms](https://axforge.ai/terms.html), [limits](https://dev.axforge.ai/docs/errors-limits/), [console](https://console.axforge.ai/).
- [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits), [API keys](https://openrouter.ai/keys).

## Secrets and state

See [persistent caching and quota optimization](TRANSLATION-CACHE.md) for content
hashes, field deduplication, batch ownership, deletion retention and cache metrics.

All credentials are GitHub Actions Secrets, never frontend configuration:

`GEMINI_API_KEY`, `GROQ_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ZAI_API_KEY`, `AXFORGE_API_KEY`, `OPENROUTER_API_KEY`.

Optional accounts without credentials or free-account assurance are skipped. `automation/state/translation-providers.json` stores numeric reservations, usage, cooldowns, outcomes and sanitized events. Each reservation is atomically persisted **before** sending the request. Both workflows share the existing `mirror-writes` concurrency group and process lock. A crash retains conservative usage reservations. Provider errors never include response bodies, URLs containing credentials, authorization headers or key values in state/logs.

## Failure, quality and recovery

429, 5xx, timeouts, network failures, authentication errors, malformed/incomplete JSON and failed protected-fact/Arabic validations immediately try the next eligible provider. `Retry-After`, quota reset headers and Google retry details are respected. A circuit breaker backs off repeated failures; expired cooldowns become eligible automatically. Authentication failures are retried after a cooldown to allow a replaced secret to recover without manual state edits. Request attempts per run are bounded.

The shared schema, protected-term prompt, source hashes and Arabic semantic checks are retained. The router validates before accepting a response; invalid Arabic tries another provider. The existing engine owns persistent queues/cache and field deduplication. No provider performs a full archive backfill. Automated checks reduce factual errors but do not replace a professional human review of every output.

Validation is per field after the complete response schema passes. Good fields from an otherwise rejected batch are checkpointed in `pendingFields`; only missing/rejected fields go to the next provider. Partial checkpoints survive normal failed runs and are committed with provider state. Completing a request transfers ownership to the existing translation cache. A hard runner termination before its Git commit can lose uncommitted results; exactly-once execution across a remote API and Git is not promised. Provider-enforced free plans remain the cost boundary.

If every alternative is unavailable before the last field passes, the router returns explicit partial status. The news/editorial engines independently validate every field, publish only accepted Arabic, and retain English plus durable retries for rejected fields. A single difficult headline cannot withhold unrelated valid pinned/project translations. Ordinary whole-response schema failures still reject the malformed response.

The old Gemini-only field retry timestamps and daily cap do not block a healthy alternative: router-managed provider quotas/cooldowns replace those global gates. Groq minute admission uses an explicitly approximate token estimate, with actual response token counts and rate-limit headers authoritative; daily/monthly reservations remain conservative. Unknown usage is not presented as a measured total.

`news-baseline.json` records field hashes from the pre-activation snapshot. Historical stories remain excluded unless a specific field changed; only those edits are eligible. This also recovers edits that canonical synchronization had already downloaded before the router upgrade, without retranslating the archive.

## Verified account activation and live checks

The owner confirmed Gemini, Groq, Cloudflare Workers AI and Z.AI credentials were added as Secrets and those accounts have no automatic billing. `TRANSLATION_FREE_PROVIDERS=gemini,groq,cloudflare,zai` enables only those authenticated accounts. AxForge/OpenRouter remain disabled without credentials and an equivalent confirmation.

A small public two-field benchmark passed all four adapters on 2026-11-28: Gemini 13.685 s, Groq 0.367 s, Cloudflare 2.727 s, Z.AI 2.190 s. Those are single-sample observations, not latency guarantees or a statistical Arabic-quality benchmark. Gemini/Groq/Cloudflare produced understandable Arabic; the Z.AI sample had weaker grammar, so it remains later in priority. Model choices are not automatically upgraded. A controlled injected Gemini 503 caused a real successful Groq request, followed by automatic recovery and a real successful Gemini request after cooldown. [Benchmark](https://github.com/General-c4/portwatch-vi/actions/runs/46113268084), [controlled fallback/recovery](https://github.com/General-c4/portwatch-vi/actions/runs/46113479375).

The OVH anonymous probe failed schema validation, then returned HTTP 429 with a long retry deadline. That deadline is persisted through 2026-12-31 23:59:57 UTC; no workaround or authenticated paid request is attempted. It is not counted as an available backup. Whole-news testing identified and fixed overlapping-name residue validation and ordinary hyphenated prose protection; failed samples were not published.

The subsequent complete six-field current-news benchmark passed Gemini (4.819 s) and Groq (2.938 s). Cloudflare's full response was rejected for protected identifiers; Z.AI timed out at 60 seconds. They remain later backups with circuit breakers, not equivalent-quality guaranteed replacements. [Complete-news check](https://github.com/General-c4/portwatch-vi/actions/runs/46115207950).

Structured events record the selected provider/model, success/fallback/skip, sanitized category, latency, actual token counts when reported and $0 eligible-request cost. Missing token counts are unknown; conservative reservations remain. If every free provider is unavailable, content stays queued. Scheduled GitHub Actions can be delayed and do not guarantee uninterrupted translation or real-time synchronization.

## Other providers reviewed

The complete reference README included Aion Labs, Cohere, Gemini, Z AI, AxForge, Cloudflare, Gonka Broker, Groq, Kilo, LLM7, ModelScope, NVIDIA NIM, OpenRouter, OVH, Runcrate and SiliconFlow. It was used for discovery, not as price/terms authority.

Cohere trial keys distinguish experimentation from paid public production, so they are excluded without suitable production permission. Aion requires payment-card verification; it is not selected. Gonka's free tier is conditional on account availability and SMS verification; it is not selected without verifying the account's actual grant. Kilo's model pool changes and some models impose trial-only terms, so no generic free router is selected. LLM7 does not document a reliable current free quota. ModelScope/SiliconFlow require identity/account verification and were not proven suitable for this account. NVIDIA's developer/trial access is not used as a production entitlement. Runcrate's signup-specific allowance was not verified for this user. None is silently enabled from a community README claim.

## Validation

`node --test tests/*.test.mjs` includes router fallback/recovery, quota/reset, strict free-model policy, HTTP adapter, persistent restart and secret-redaction regressions. Existing tests cover cache hashes, queues, no-overlap locks, source conflicts, canonical additions/deletions/unknown fields, stale deployment rejection and Arabic/English rendering. Live provider quality and latency must be reported separately from mocked tests; disabled providers have no measured Arabic quality or latency yet.
