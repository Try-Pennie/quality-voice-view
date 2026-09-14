# Eavesly UI performance baseline

Collected 2026-09-14 ~00:13–00:20 UTC (September 13 evening ET). Read-only investigation; no application, database, or deployment changes.

## Summary

Two observed production Calls-page data-fetch bursts span **21.497 seconds** and **20.812 seconds** from first call-list log to last QA-summary log. Each contains **70 call-list requests followed by 231 QA-summary requests**. This is a log-derived API-activity span, **not a browser-measured page-load duration**. The deployed code waits for all those calls and QA summaries before returning dashboard data, although the UI only renders 25 rows per page.

The agent dropdown separately generates roughly 60+ requests per fetch in these samples. Team pitch-risk data also pages through tens of thousands of calls. Alert-list requests themselves take multiple seconds.

## Sources and limitations

- Production Supabase project: `miikotqnovnixpeqtqnd` (Eavesly).
- Logs: `edge_logs`, exact referer `https://eavesly.com/`, excluding OPTIONS. This excludes server jobs and previews with different referers but does not distinguish human use from browser automation.
- Timings: numeric `response.origin_time`, reported in milliseconds; origin/API timing excludes the complete browser/network/render experience.
- Recent window: **2026-09-13 00:13 UTC–2026-09-14 00:13 UTC**. Just **one authenticated session** in the sampled REST traffic. Do not treat request counts as independent page loads or users.
- Weekday comparison: **Friday September 11, 00:00–24:00 ET** (`2026-09-11T04:00:00Z`–`2026-09-12T04:00:00Z`). Up to five authenticated sessions in sampled REST traffic.
- p50/p95 are exact request percentiles (`quantileExact`), not percentiles of per-query averages or page durations. Small-sample p95s often equal the maximum.
- No browser page-ready/User Timing instrumentation, Sentry, or PostHog was found in the inspected application sources or downloaded production entry bundle. Accessible Sentry organization has no Eavesly project. Historical browser time-to-data and Core Web Vitals are therefore unavailable from these checked sources.
- Different frontend revisions were in use across these windows. Remote main at inspection: `704f3717099373f02dc701941e00d169691676ea`, merged 2026-09-13 23:55:41 UTC. Do not interpret Friday-versus-weekend differences as a controlled regression comparison.
- Production entry asset inspected: `https://eavesly.com/assets/index-OX10bdah.js`; decoded size 1,667,726 bytes, not compressed transfer size. Confirmed the sequential paginator, dashboard call-then-QA sequence, and call-table-based agent dropdown in that deployed asset.

## Recent request baseline, split by query shape

| Operation | Requests | p50 | p95 | Maximum |
|---|---:|---:|---:|---:|
| Calls-page list page | 140 | 147 ms | 204 ms | 1,267 ms |
| Calls-page QA-summary batch | 462 | 644 ms | 4,097 ms | 4,505 ms |
| Agent-name call-table queries (mixed dropdown/name lookup) | 127 | 99 ms | 157 ms | 1,221 ms |
| Team pitch-risk call page | 70 | 105 ms | 129 ms | 1,107 ms |
| Coaching QA JSON batch | 44 | 461 ms | 511 ms | 523 ms |
| Review queue list, current column set | 3 | 3,342 ms | 3,378 ms | 3,378 ms |
| Alert breakdown, current column set | 3 | 3,018 ms | 4,282 ms | 4,282 ms |
| Team daily-metrics RPC | 6 | 320 ms | 1,103 ms | 1,103 ms |

All these requests returned HTTP status below 400. That does not rule out client-side errors or incomplete data.

### Calls data-fetch sequences

| UTC burst | Call-list log range | List requests | QA log range | QA requests | Combined log span |
|---|---|---:|---|---:|---:|
| Sep 13 14:40 | 14:40:24.024–14:40:40.716 | 70 | 14:40:41.485–14:40:45.521 | 231 | 21.497 s |
| Sep 14 00:11 | 00:11:12.805–00:11:29.215 | 70 | 00:11:30.119–00:11:33.617 | 231 | 20.812 s |

Both lists reached offset 69,000 with 1,000-row pagination. That is consistent with fetching roughly 69,000 calls for the selected window, then QA in batches of 300. Request timestamps do not establish the navigation start or final render time; these spans are useful diagnostic observations, not an end-to-end SLA. Do not sum parallel QA durations to estimate wall-clock latency.

The first burst also had 64 name-query requests spanning 11.055 seconds, including pagination through offset 62,000; the second minute had 61 name-query requests spanning 10.667 seconds. These run alongside dashboard data rather than being additive to its critical path.

Team pitch-risk traffic reached offset 69,000 in 70 requests across 11.294 seconds of log timestamps. Friday's pitch-risk requests reached offset 97,000. These are serial page fetches to calculate counts client-side.

## Friday comparison

| Operation | Requests | p50 | p95 | Maximum |
|---|---:|---:|---:|---:|
| All call-table reads (mixed purposes) | 347 | 130 ms | 258 ms | 4,634 ms |
| Coaching QA JSON batches | 131 | 2,003 ms | 3,996 ms | 4,171 ms |
| Review queue list, previous column set | 14 | 2,713 ms | 3,570 ms | 3,570 ms |
| Alert breakdown, previous column set | 51 | 467 ms | 2,005 ms | 7,604 ms |
| Team daily-metrics RPC | 19 | 136 ms | 474 ms | 474 ms |

No HTTP errors >=400 were returned in the Friday referer-filtered results. Friday's slow QA JSON requests are **not** the same query shape as the weekend Calls-page QA summaries.

## What the code explains

Checked both local source and matching functions in the live bundle:

1. `src/lib/supabase-helpers.ts:fetchAllPaginated`: pages sequentially in 1,000-row chunks.
2. `src/lib/queries.ts:fetchDashboardData`: fetches the entire selected call window, then awaits every QA-summary batch. `src/pages/DashboardPage.tsx` paginates those results to 25 visible rows only after loading.
3. `src/lib/queries.ts:fetchUniqueAgents`: downloads recent call rows and deduplicates agent names in the browser instead of reading a small distinct-agent result.
4. `src/lib/team-queries.ts:fetchPitchRiskCounts`: downloads call rows to calculate pitch/rushed-pitch totals client-side; not covered by the existing daily-metrics aggregation.
5. `src/lib/alert-queries.ts:fetchAlerts`: loads the complete scoped/date-filtered review queue through the same sequential paginator. Individual current list reads already take ~3.3 seconds in this very small sample.
6. `src/App.tsx`: 60-second query freshness and 10-minute cache retention help warm navigation, not first uncached fetches.

These explain why a fast individual call-page query (~150 ms) can still produce a long loading screen. The request fan-out and serial pagination are observed; the database-level cause of slow QA/alert requests is not yet established.

## Recommended next measurement and optimization order

1. Establish authenticated browser **navigation/filter-change → first usable rows** and **all sections ready** timings for Calls, Review, and Team. Fix role, agent scope, date range, device/network, and deployed revision; measure cold and warm cache separately. This is the missing true UI baseline.
2. Prioritize Calls: fetch a server-paginated visible page and its QA only; compute whole-window metrics/filter options separately on the server. Preserve full-window sorting/filtering/export semantics rather than silently limiting results.
3. Replace call-table scanning for agent dropdowns with a small directory/distinct-agent query, preserving active-agent semantics and authorization.
4. Aggregate pitch-risk counts server-side instead of downloading all calls.
5. Inspect actual query plans for slow alert-list and QA shapes before adding indexes or changing joins. Keep permission scope unchanged.

Do not change production merely to collect the above evidence.

## Reproduction: Supabase Logs Explorer / query_logs

Project: `miikotqnovnixpeqtqnd`. Supply one of the exact windows above through `iso_timestamp_start` and `iso_timestamp_end`; maximum supported window is 24 hours.

```sql
select
  log_attributes['request.path'] as endpoint,
  extractURLParameter(log_attributes['request.url'], 'select') as projection,
  count() as requests,
  round(quantileExact(0.5)(toFloat64OrNull(log_attributes['response.origin_time'])), 1) as p50_ms,
  round(quantileExact(0.95)(toFloat64OrNull(log_attributes['response.origin_time'])), 1) as p95_ms,
  max(toFloat64OrNull(log_attributes['response.origin_time'])) as max_ms,
  max(toUInt64OrZero(extractURLParameter(log_attributes['request.url'], 'offset'))) as max_offset
from logs
where source = 'edge_logs'
  and log_attributes['request.headers.referer'] = 'https://eavesly.com/'
  and log_attributes['request.method'] = 'GET'
  and log_attributes['request.path'] in (
    '/rest/v1/eavesly_calls',
    '/rest/v1/eavesly_transcription_qa',
    '/rest/v1/eavesly_alerts_with_feedback'
  )
group by endpoint, projection
order by requests desc;
```

This query was executed for both windows. Burst reconstruction grouped the same rows by `toStartOfMinute(timestamp)`, endpoint, and projection, returning `min(timestamp)`, `max(timestamp)`, request counts, and offset ranges. No session tokens, user identifiers, or call contents are included in this artifact.

Historical `pg_stat_statements` also showed slow authenticated alert query shapes, but its global reset is July 23, 2025, with seven deallocations. Those cumulative statistics are not a current-window baseline and were not substituted for the log percentiles above.
