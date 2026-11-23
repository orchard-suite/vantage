# ADR-2001: Agents sign in through the hub

| | |
|---|---|
| **Decision Date** | 2026-03-02 |
| **Decision Maker** | Avery Example, Sam Sample |
| **Last Updated** | 2026-04-10 |

## Status

Superseded by [ADR-2002](2002-agents-use-device-codes.md)

## Context

Agents need a key. Keys in files leak.

## Decision

Agents sign in through the hub with a personal token.

## Verification

A test signs an agent in.

## Consequences

One place to revoke a key.

## Alternatives Considered

### Shared service key

One key for everyone cannot be traced to a person.

### No sign-in

Anyone could write.

## Related

- [ADR-1001](1001-one-cluster.md)
