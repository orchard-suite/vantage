This page is for the [[ops-team]]. It says what runs, what it leans on, and how a change reaches production.

## What runs {#what-runs}

![The whole shop on one picture](view:end-to-end)

The application tier holds the [[web-app]], the [[orders-api]], the [[catalog-api]], and the [[order-worker]]. Secrets come from [[key-vault]]. Telemetry goes to [[app-insights]].

## Releasing {#release}

A push to main runs the tests. A green run builds an image and pushes it to the [[container-registry]]. The cluster then syncs to it.

![From a push to live](view:release)

1. Push to main.
2. Wait for the tests.
3. Watch the sync finish.

> A red test run stops the release. Fix forward; never skip the gate.

## Payment outage {#payment-outage}

When [[stripe]] is down, orders are still accepted and wait on [[order-events]]. The [[order-worker]] retries them. See [orders go async](view:how-an-order-works#async).
