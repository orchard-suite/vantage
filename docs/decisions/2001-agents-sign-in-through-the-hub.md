# ADR-2001: Agents Sign In Through the Hub

| | |
|---|---|
| **Decision Date** | 2026-11-19 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-19 |

## Status

Accepted

## Audience

Anyone changing how agents reach `/mcp`, and anyone running a hub.

## Purpose

Settles who signs a person in when an MCP client that speaks OAuth (a
custom connector in Claude, any client that follows the MCP authorization
spec) connects to a hub: the hub does, as the authorization server for its
own `/mcp`.

## Context

MCP clients sign people in with OAuth and expect to register themselves
(dynamic client registration). Microsoft Entra ID offers no registration
endpoint. Pointing such a client at Entra needs an app registration per
client at every estate, and Claude's connector and Entra's v2 endpoint
disagree today (Claude sends a `resource` parameter Entra refuses with
AADSTS9010010, and forces a consent prompt Entra refuses with 90095). Those
bugs are outside this project. A hub behind a front door (`AUTH_MODE=proxy`)
has no issuer of its own to point at. Every hub already signs its people in
for its pages and already mints personal tokens (device code flow).

## Decision

The hub is the OAuth 2.1 authorization server for its own `/mcp`.

- The resource metadata (RFC 9728) names the hub; the hub publishes its
  authorization server metadata (RFC 8414).
- Clients register themselves (RFC 7591) as public clients. Redirects are
  https, or http to a loopback address.
- The person approves a client on `/oauth/authorize`, signed in the way they
  sign in to every page (the session, or the front door). A bad client or
  redirect is shown, never followed.
- PKCE with S256 is required. A code lives ten minutes and works once.
- An approval is a grant. A grant holds one access token, an ordinary
  personal token that lasts an hour, and a refresh token that rotates on
  every use and lapses after 30 days unused. A refresh token shown by
  another client revokes the grant.
- The person sees each grant as a connected app on the Account page and can
  disconnect it, which ends its token at once.
- Tokens an identity provider signs (`OIDC_API_SCOPE`) stay accepted on
  `/mcp`, for agent platforms set up by hand, such as Copilot Studio.

## What this means for the code

- `packages/hub/src/auth/oauth.ts` holds the grants and tokens;
  `packages/hub/src/web/oauth-routes.ts` holds the endpoints.
- A new way into `/mcp` issues hub tokens through a grant, never a second
  kind of bearer.
- A hub behind a front door routes `/.well-known/oauth-*`, `/oauth/register`,
  and `/oauth/token` around the door, and keeps `/oauth/authorize` behind it
  (`docs/deploy.md`, "Behind a front door").

## Verification

`packages/hub/src/web/oauth.test.ts` covers registration, approval, the code
exchange with PKCE, refresh rotation, reuse of a spent code or refresh
token, another client's code, an unregistered redirect, and disconnecting.

## Consequences

- Better: Claude Desktop, claude.ai, and any OAuth MCP client connect with
  the hub's address alone, at every estate, with no registration at the
  identity provider.
- Better: one kind of token on `/mcp`, revocable by the person.
- Worse: the hub owns an authorization server, and its correctness is ours
  to test.
- Worse: anyone may register a client. Registration is rate limited, and
  clients never approved are pruned after a day.

## Related

- Platform standard `one-front-door-for-web-sign-in` and
  `bearer-tokens-bound-to-revocable-policies` (2026.1119.1418).
- `docs/spec.md`, "Agents sign in through the hub".
