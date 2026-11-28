# Persistent translation cache and quota optimization

AI inference runs only in GitHub Actions. Public pages load static Arabic JSON;
page views, navigation, refreshes and the catalog's polling never call an AI API.
The existing free-model allowlist, account assurances, quotas and circuit breakers
remain mandatory. No billing, paid model or credit-purchase operation is added.

## Durable storage and migration

The existing `automation/state/news-translations.json.cache` is extended to schema
version 2, rather than introducing another translation cache. Keys are SHA-256 of
the exact original field text. Entries retain source text, Arabic, source hash,
source/target languages, validation status, provider, model and translation time.
References include the original record identifier, field, full translatable-content
hash and individual field hashes. Multiple records/fields can reference one value.
`cacheRecords` records content hashes and deletion clocks by scope. The published
`assets/i18n/news/ar.json` remains the frontend's static translation catalog.

Both files are committed to Git with the existing synchronization checkpoints and
included in recovery artifacts. GitHub Actions caches are used for dependencies,
not as the authoritative translation store. A deployment does not erase the cache.
Old records are migrated without new inference; unavailable historical timestamps
remain null and unknown historical providers are marked `legacy-unknown` rather
than invented. Existing known model metadata is preserved.

## Selection, deduplication and batching

Only the exact fields missing a valid reviewed/published/cached translation are
eligible. Hashes exclude dates, images, scores and source-link metadata. A title
edit cannot invalidate an unchanged summary or paragraph. Changing providers,
priority or models does not invalidate completed translations. Invalid translations
and actual source edits remain eligible for correction.

News requests combine up to four eligible records and twenty unique fields when
the existing byte/token bounds permit. Multi-record batches use indexed fields
with explicit ownership; source URLs are echoed and validated. Identical text is
sent once per batch. Later batches recheck the cache before inference. Dynamic
editorial batches also collapse duplicates and publish the accepted result to every
matching reference. Protected facts, URLs, numbers and Arabic quality gates remain.

Provider fallback sends only unaccepted fields. Partial provider checkpoints are
keyed by source text, independent of provider/model and unrelated URL metadata;
legacy partial keys remain readable during migration. Each accepted field carries
its actual provider/model/time through a mixed-provider result. Malformed response
schemas still fail; valid siblings can publish while invalid fields stay queued.

## Deletion and retention

A valid official live snapshot confirms source absence. A repository fallback alone
does not authorize retirement. If all authoritative downloads fail, synchronization
exits before changing translation files. Confirmed deletions leave the active
catalog immediately, retain cached Arabic for 30 days, and remove their pending
work. Restoring the same text within that window reuses the cache without inference.
Expired orphan values are cleaned on subsequent successful synchronization, and
cannot be revived after expiry just because no cleanup ran on the deadline.
Unchanged active translations have no expiry. Editing/removing a field can orphan
its previous text while another active reference keeps shared text alive.

Set repository variable `TRANSLATION_CACHE_RETENTION_DAYS` to change retention
(1–3650 days, default 30); synchronization and backfill jobs pass it server-side.
This affects orphaned values, never active unchanged translations.

## Concurrency and statistics

All writer workflows retain `mirror-writes` with cancellation disabled. Checkout
occurs inside the serialized job, so the next job reads the previous committed
cache. The process-level exclusive lock prevents local overlapping writes. Existing
normal-push/rebase validation and recovery artifacts remain in place. A hard runner
termination after an API response but before persistence can still lose that result;
exactly-once remote inference cannot be guaranteed across that crash boundary.

`.sync/status.json.translationCache` reports total/new/modified/unchanged news,
newly published translated fields, reuse, cache hits/misses and hit percentage,
deduplication, expired entries, pending news/editorial work and logical batches.
`actualAPI` reports actual provider attempts, per-provider input/output/thinking
tokens, unknown-usage requests and eligible estimated cost ($0). Failed fallback
attempts count too. Unknown provider token totals are not reported as known zero
usage: the unknown counter must be read alongside measured token subtotals.

`avoidedFieldRequests` and `avoidedAPIRequestsEstimate` use an explicitly stated
one-unbatched-request-per-field baseline. They are estimates of avoided work;
the exact number of saved batched API calls is counterfactual and depends on batch
sizes and token bounds. Hit rates include reviewed/static/template reuse as well
as the AI field cache. Statistics describe synchronization executions, not visitors.

An unchanged **fully translated** snapshot makes zero inference requests. An
unchanged snapshot with pending/invalid fields can retry those fields when an
eligible free provider recovers; otherwise pending translations would never recover.
All new/modified fields use English until their matching Arabic passes validation,
so an old translation is never silently shown against edited source text.

## Acceptance validation

`tests/translation-cache.test.mjs` verifies 10,000 visitor render/refresh simulations
with zero fetches, and scans every frontend module for AI endpoints/credentials.
This is a structural/simulation test, not a claim of 10,000 real browser sessions.
Existing live browser checks exercise actual navigation, language switching and
resource loading. Other acceptance cases cover JSON restarts, model/provider
switches, metadata-only sync, changed fields, distinct batched record ownership,
deduplication, deletion/restoration/expiry, configurable retention, active values
years later, uncertain upstream absence, and overlapping runs with persisted state.
Existing canonical-failure, free-only, quota, fallback/recovery and secret-redaction
tests continue to run. No test or deployment security gate is disabled.
