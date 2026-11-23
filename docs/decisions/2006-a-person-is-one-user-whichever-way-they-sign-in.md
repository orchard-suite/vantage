# ADR-2006: A Person Is One User Whichever Way They Sign In

| | |
|---|---|
| **Decision Date** | 2026-11-22 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-22 |

## Status

Accepted

## Audience

Anyone setting up a hub's sign-in, or building a module or an agent
platform that calls the hub as the person who used it.

## Purpose

Settles how the hub knows that a browser sign-in, a front door, and a
token another app got for the person are the same person, so a module
acting for someone never makes a second user with none of their roles.

## Context

A person reaches the hub in several ways. They sign in in a browser with
the hub's own OIDC client, or a front door names them in a header. An
agent platform, or a module acting for them
([ADR-2005](2005-a-module-acts-on-an-item-as-the-person-who-acted.md)),
sends a token the issuer signed for the hub.

The hub matched a person by the token's `sub`. Entra gives each app its
own `sub` for the same person: its claims reference says two apps
signing in the same user get two different values, and that `oid` stays
the same across apps. A token Forms got for a person, and one Copilot
got for the same person, would have made two users, neither with the
roles the person's browser sign-in holds. A front door names a person by
address and carries no id at all.

## Decision

The hub knows a person by the issuer's id for them, the claim
`OIDC_PERSON_CLAIM` names.

- **One claim names a person in every token.** `oid` on Entra. The
  default, `sub`, fits an issuer whose `sub` is the same for every app.
- **Every way in looks the same way.** A sign-in is matched by that id
  first, then by the subject its own way of signing in gives (a browser's
  `sub`, a front door's address). A user keeps the id from the first
  sign-in that carries it.
- **A person known only by address is found by address, once.** When a
  token carries an id the hub has never seen, and exactly one user has
  that address and no id yet, that user is the person, and keeps the id.
  Two users with the address, or one already tied to another id, link
  nobody. This covers people a front door made, and people who signed in
  before the claim was set.
- **A token must carry the claim.** A token without it is refused.
- **A front door hub takes the issuer's tokens too.** With
  `OIDC_ISSUER` and `OIDC_API_SCOPE` set, a hub whose pages sit behind a
  front door takes a person's token on its bearer routes, the same as an
  OIDC hub. The front door still signs people in to the pages.

## What this means for the code

- `users.person_id` holds the id, unique in an organization
  (`packages/hub/migrations/0032_user_person.sql`).
- `packages/hub/src/auth/identity.ts` matches a sign-in in the order
  above. The browser callback (`oidc.ts`) and the token check
  (`issuer-token.ts`) both read the claim.
- `createIssuerTokens` starts under `oidc` or `proxy` sign-in. It names
  the hub by `OIDC_CLIENT_ID`, `OIDC_API_AUDIENCE`, or both.

## Verification

`packages/hub/src/auth/issuer-token.test.ts`: two apps' tokens with
different `sub` and the same `oid` reach one user; a user a front door
made is found by address, then by id after the address changes; a shared
address, or one already tied to another id, links nobody; a browser user
made before the claim was set gets the id; a token without the claim is
refused; a front door hub takes the tokens. The first five fail without
this change. `packages/hub/src/tracking/modules.test.ts` puts and moves
an item through a module with a token the issuer gave the module for the
person, and the feed names the person and the module's client, with one
user for them.

## Consequences

- A module, an agent platform, and a browser all act as the same user,
  with the same roles and the same history.
- An Entra hub sets `OIDC_PERSON_CLAIM=oid`. Its people get their id at
  their next browser sign-in, or at their first token, by address.
- The one match by address trusts the issuer's address for a person who
  has no id yet. The issuer is one tenant the hub names, and the link
  happens once per person.

## Related

- [ADR-2005](2005-a-module-acts-on-an-item-as-the-person-who-acted.md):
  why a module acts as the person, and how it gets the token.
- [ADR-2001](2001-agents-sign-in-through-the-hub.md): agents that sign in
  through the hub itself.
- Platform standard 2026.1120.2003: follows
  `one-subject-per-person-the-directory-object-id` and
  `one-front-door-for-web-sign-in`. Linking a person a front door named by
  address to the issuer's id, once, is new ground.
