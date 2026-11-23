# ADR-2003: The Hub Signs In to Postgres as Its Workload Identity

| | |
|---|---|
| **Decision Date** | 2026-11-21 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-21 |

## Status

Accepted

## Audience

Anyone deploying the hub on a Postgres the estate brings, or changing how
the hub opens a database connection.

## Purpose

Settles how the hub proves itself to a Postgres server that takes no
passwords.

## Context

An estate may run one managed Postgres server for its platform services,
with a database and a role for each. Such a server often takes identity
sign-in only: a client signs in with a short-lived token for its workload
identity, and there is no password to store. The hub knew one way in, the
password inside `DATABASE_URL`, so it could not use such a server.

## Decision

`DATABASE_AUTH` says how the hub signs in. `password`, the default, uses
the password in the URL. `azure` asks the pod's workload identity for an
Entra token and sends it as the password. The URL then carries the user
and no password. The hub asks for a token each time it opens a connection,
the listener's connection included, so no connection is ever opened with
an expired one.

The chart sets it with `database.auth`, and takes a connection string
that holds no secret as a plain value, `database.external.url`.

### Alternatives

- **A password kept in a secret store.** Rejected: a server that takes
  identity sign-in only refuses it, and it is one more long-lived secret.
- **A sidecar that writes a fresh token into a file or a pooler.**
  Rejected: one more container per pod, and a pooler in transaction mode
  drops `LISTEN`.

## What this means for the code

`packages/hub/src/db/auth.ts` turns the setting into a password source.
`packages/hub/src/db/postgres.ts` hands it to the driver, which calls it
for every connection. Another identity provider is one more value of
`DATABASE_AUTH` and one more branch in `auth.ts`.

## Verification

`packages/hub/src/db/auth.test.ts`, and the password source test in
`packages/hub/src/db/postgres.test.ts`, which runs against a real
Postgres when `VANTAGE_TEST_DATABASE_URL` is set.

## Consequences

The hub's database needs no secret. A nightly `pg_dump` from the chart
cannot sign in this way, so the chart refuses `database.dumps` with it;
the managed server keeps the backups.

## Related

- ADR-2002: A connector reads its secrets as its own app.
