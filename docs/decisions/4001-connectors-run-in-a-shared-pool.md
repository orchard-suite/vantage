# ADR-4001: Connectors Run in a Shared Pool

| | |
|---|---|
| **Decision Date** | 2026-11-19 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-19 |

## Status

Accepted

## Audience

Anyone changing how connectors are scheduled, run, or deployed, and anyone
sizing a hub for an organization with many workspaces.

## Purpose

Settles where a connector runs and who decides when, so that adding
connectors never adds machines and a person can run one now.

## Context

Each connector ran as a Kubernetes CronJob of its own, every ten minutes,
started by its own scheduler outside the hub. The hub could not start a
run, so nobody could refresh a diagram on demand. Each connector also cost
a pod and a Helm values edit, so cost and toil grew with the number of
connectors, not the work they do. An organization of a hundred people with
diagrams everywhere would buy nodes for connectors that mostly sit idle.

The hub must still hold no credential for any connector: what a connector
reads is exactly what its own app may read.

## Decision

A connector with an interval runs in one shared pool of runners beside the
hub, and the hub schedules it.

- The hub's worker queues a `connector-run` job when a connector's interval
  comes round, spread over the interval by the connector's id. An author's
  Run now queues one at once. One run of a connector waits and one runs at
  a time, so repeated asks cost one run.
- The pool leases runs from the hub's job queue over HTTP, as its own app
  with the hub's pool role. The hub's own worker never claims a connector
  run. A lease request waits at the hub, woken by the queue's notices.
- The pool runs each lease as the connector's own app: every connector app
  trusts the pool's service account with a federated credential, so one
  workload identity token signs in as any of them.
- Memory follows the runs at once (replicas times concurrency). A workspace
  holds at most `CONNECTOR_MAX_PER_WORKSPACE` connectors, on intervals of
  at least `CONNECTOR_MIN_EVERY_MINUTES`.
- A kind that reads as the machine it runs on (in-cluster `kubectl`) keeps
  a runner of its own and takes no interval.

### Alternatives

- **An always-on runner per connector, woken by the hub.** Rejected: a pod
  per connector, idle almost always, so memory grows with the count.
- **The hub creates a Job from each connector's CronJob.** Rejected: the hub
  would need rights to create pods, would be bound to Kubernetes, and only
  chart-deployed runners could be run.

## What this means for the code

- `packages/hub/src/sources/runs.ts` owns when a connector is due, why it
  cannot run, and queuing a run; the scheduler, the API, the page, and the
  MCP tool call it.
- `packages/hub/src/api/pool.ts` is the pool's surface; `claim` takes a lane
  so the hub and the pool never take each other's jobs.
- `packages/connectors/src/pool.ts` is the pool runner
  (`vantage connector pool`); the chart's `connectors.pool` deploys it.

## Verification

`packages/hub/src/sources/pool.test.ts`: an interval only for a kind the
pool runs, the per-workspace cap, Run now once however often asked, leases
only to the pool, the scheduler's due minute, and a pool run that signs in
as the connector's app and lands its boxes.

## Consequences

- Run now works for every connector with an interval.
- Each connector app needs one federated credential for the pool, and its
  secrets move to Key Vault (ADR-2002).
- The pool talks to the hub over HTTP, not the database: it holds the
  connectors' sign-in, and the hub holds none.

## Related

- ADR-2002: A connector reads its secrets as its own app.
