# ADR-2002: A Connector Reads Its Secrets as Its Own App

| | |
|---|---|
| **Decision Date** | 2026-11-19 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-19 |

## Status

Accepted

## Audience

Anyone adding a connector kind that needs a secret, or granting a
connector's app its reads.

## Purpose

Settles where a connector's secret comes from once many connectors share
one runner.

## Context

A connector names its secrets by reference (the Orrery `token`). A runner
of its own read them from its own environment, filled from a Kubernetes
secret. In the shared pool (ADR-4001) one environment serves every
connector, so any connector's settings could name any other's variable and
send it wherever its settings point.

## Decision

A secret a pool connector names is a Key Vault secret URL, read with a
token for the connector's own app. The pool reads no environment variable
for a connector. A runner of its own may still read its environment.

### Alternatives

- **Secrets in the hub's sealed store.** Rejected: the hub would hold a
  credential for every connector.
- **One environment per connector in the pool.** Rejected: it brings back a
  deployment change per connector.

## What this means for the code

`packages/connectors/src/secrets.ts` resolves a reference; the runner hands
every run the connector app as its `identity`, which a kind such as Azure
Resource Graph also reads with.

## Verification

`packages/connectors/src/secrets.test.ts`.

## Consequences

Each connector app gets Key Vault Secrets User on its own secrets and
nothing more, so a connector can read only what was granted to it.

## Related

- ADR-4001: Connectors run in a shared pool.
