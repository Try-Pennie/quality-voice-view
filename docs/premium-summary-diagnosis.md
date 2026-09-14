# Premium UI Calls-summary diagnosis

## Decision

Propose `20260916010000_optimize_calls_summary.sql`, a query-only replacement of
`eavesly_calls_summary`. It removes the two `MATERIALIZED` summary stages and
aggregates the date/agent window once. It adds no index, cache, timeout change,
or persisted summary.

Confidence is **high** that the old plan performs avoidable temp-file work,
**medium** that removing it provides a useful latency reduction under load, and
**low** that it explains the production 6.881 s first execution by itself. The
69,204 deterministic latest-QA probes remain the dominant work. Production
cache/I/O effects are plausible but are not proven by a fresh database
connection.

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
| Shared buffers | 211,684 | 211,684 |
| Temp blocks read | 1,036 (~8.1 MiB) | 498 (~3.9 MiB) |
| Temp blocks written | 1,307 (~10.2 MiB) | 499 (~3.9 MiB) |
| Materialized CTE scans | `windowed`, `joined` | none |
| Latest-QA index probes | 69,204 | 69,204 |

Five-run warm medians varied on the shared development host:

| Run | Applied | Proposed | Change |
|---|---:|---:|---:|
| research A | 450.227 ms | 357.988 ms | -20.5% |
| research B | 367.695 ms | 337.463 ms | -8.2% |
| research C | 383.033 ms | 309.639 ms | -19.2% |
| integration A | 461.610 ms | 458.041 ms | -0.8% |
| integration B | 381.669 ms | 379.567 ms | -0.6% |
| final verification | 470.466 ms | 421.432 ms | -10.4% |

These are synthetic database timings, not claims of production or browser
speedup. Concurrent work on the host produced visible variance. Each timed run
starts a fresh `psql` connection, but that clears neither PostgreSQL/host file
cache state consistently nor the host OS page cache. Restarting the owned
container clears PostgreSQL shared buffers only; it is still not a cold-OS-cache
measurement. The stable evidence is reduced temp work with identical results;
the wall-clock benefit should be rechecked serialized on the review machine.

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
old/new five-run medians and nested plan buffer lines, and labels fresh
connections and synthetic latency limits explicitly.
