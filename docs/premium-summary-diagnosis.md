# Premium UI Calls-summary diagnosis

## Decision

Propose `20260916010000_optimize_calls_summary.sql`, a query-only replacement of
`eavesly_calls_summary`. It keeps the shared date/agent window materialized for
window totals and disposition options, but streams the latest-QA join into the
single filtered KPI aggregate. It adds no index, cache, timeout change, or
persisted summary.

Confidence is **high** that the old `joined` materialization performs avoidable
temp writes and **medium** that removing it provides a useful latency reduction
under load. Confidence is **low** that it explains the production 6.881 s first
execution by itself. Production cache/I/O effects are plausible but are not
proven by a fresh database connection.

## Production facts supplied for this investigation

- 846,429 Calls and 496,959 QA rows overall.
- 69,204 Calls in the 30-day window.
- `eavesly_calls.started_at desc nulls last` is non-covering.
- Latest QA uses `(call_id, created_at desc nulls last, id desc)` with four
  included grades; its reported production size is about 50 MB.
- Authenticated Calls reads have two redundant `using (true)` RLS policies.
- API statement limit is 8 seconds. An initial combined smoke timed out at 10
  seconds; isolated summary observations were 6.881 s, then 0.691/0.659 s.
- Reported runtime settings: PostgreSQL 17, `work_mem=3500kB`, JIT off,
  `shared_buffers=256MB`, `effective_cache_size=768MB`, and
  `random_page_cost=1.1`.

No production write, migration, index creation, or deployment was performed.

## Representative PostgreSQL 17 model

The Docker check creates 846,429 wide Calls rows and 496,959 wide QA rows, but
puts exactly 69,204 Calls in the measured window. QA contains repeat versions
and null `created_at` values. Tables use the deployed non-covering Calls index,
the applied latest-QA covering index, authenticated RLS, production-like memory
and planner settings, and `VACUUM (ANALYZE)` before measurement.

The old function is renamed only inside the disposable database. Forty cases
compare exactly equal, complete old/new JSONB values across the cross-product of:

- all five quick filters;
- empty and selected agents;
- empty and selected dispositions; and
- default and custom thresholds.

The production-count corpus is also compared as complete JSONB, not only by
counts. Existing assertions retain latest QA ordering (`created_at desc nulls
last, id desc`), QA-count KPI denominators, negative-half JS rounding parity,
rushed-call normalization/bounds, finite input bounds, invoker security, empty
search path, and authenticated-only execute grants.

## Plans and timing

At 8 kB per buffer block, one representative full-window plan changed from:

| | Applied function | Proposed function |
|---|---:|---:|
| Shared buffers | 211,684 | 211,687 |
| Temp blocks read | 1,036 (~8.1 MiB) | 1,036 (~8.1 MiB) |
| Temp blocks written | 1,307 (~10.2 MiB) | 518 (~4.0 MiB) |
| Materialized CTE scans | `windowed`, `joined` | `windowed` only |
| Latest-QA probes, `all` | 69,204 | 69,204 |
| Latest-QA probes, `rushed` | 69,204 | 5,472 |

A review found that the first one-pass candidate let PostgreSQL inline the
`selected` expression into every aggregate `FILTER`. That candidate regressed
the rushed median from 631.751 ms to 2,968.999 ms (4.7x) and was superseded.
The final shape restores one `filtered` predicate and lets PostgreSQL apply the
Calls-only rushed predicate before the latest-QA join.

Representative medians from the corrected run were:

| Case | Applied | Proposed | Change |
|---|---:|---:|---:|
| all, full window | 393.110 ms | 360.274 ms | -8.4% |
| rushed, full window | 674.037 ms | 422.008 ms | -37.4% |
| threshold, full window | 420.899 ms | 348.126 ms | -17.3% |
| compliance, full window | 409.449 ms | 338.893 ms | -17.2% |
| one agent, full window | 50.314 ms | 50.916 ms | +1.2% |
| all agents, six-hour window | 171.711 ms | 172.478 ms | +0.4% |

Full-window `all` uses five runs; the added filter/selectivity checks use three
to keep the 846k/497k fixture bounded. A runtime gate rejects any over-25%
median regression for every measured case. These are synthetic database
timings, not claims of production or browser speedup. Concurrent work on the
host produced visible variance. Each timed run starts a fresh `psql`
connection, but that clears neither PostgreSQL/host file
cache state consistently nor the host OS page cache. Restarting the owned
container clears PostgreSQL shared buffers only; it is still not a cold-OS-cache
measurement. The stable evidence is removal of the `joined` temp write, one
rushed predicate in the plan, and identical results; wall-clock benefit should
still be rechecked
serialized on the review machine.

## Alternatives rejected

### Calls covering index

A candidate index on `started_at` including `agent_email`, `call_id`,
`disposition`, `campaign_name`, `talk_time`, and `handle_time` was 83 MB in the
fixture, versus 31 MB for the existing Calls time index. It reduced one captured
Calls scan from 19.8 ms to 10.4 ms, while full-summary medians were unstable and
did not establish an additional durable benefit. It would maintain another
large index on every Calls insert and make updates to any included column
ineligible for HOT updates. It is not proposed.

### Bulk latest-QA scan

Replacing bounded lateral probes with a full ordered/distinct scan of the QA
index was slower: 393.445 ms versus 337.463 ms for an unfiltered window, and
481.798 ms versus 327.125 ms for the selective case in the same run. The
existing latest-QA index and lookup semantics are retained.

### Cache or timeout

A persisted count cache would add staleness and authorization complexity. A
higher statement timeout would conceal rather than reduce work. Neither is
proposed.

## Verification

Run from the repository root:

```bash
bash supabase/migrations/ui-load-performance.integration.check.sh
```

The check uses a unique Docker container name, removes that container and its
anonymous volume on exit, exercises the public RPC as `authenticated`, prints
old/new medians for all/rushed/threshold/compliance/selective-agent/selective-
date calls, rejects material regressions, verifies one rushed predicate in the
plan, and labels fresh connections and synthetic latency limits explicitly.
