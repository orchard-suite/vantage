# ADR-5006: The Estate Maps a Repository to Its Hub

| | |
|---|---|
| **Decision Date** | 2026-11-22 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-22 |

## Status

Accepted. Supersedes [ADR-5005](5005-a-repository-points-at-its-document.md).

## Audience

Anyone changing the plugin's hooks, the onboarding or decision skills, or
the pointer a repository carries.

## Purpose

Settles where a repository's hub and workspace are named, now that one
repository is read by many estates.

## Context

ADR-5005 put the hub and workspace in the repository's `vantage.yaml`. A
public repository, or one several estates clone, cannot name one
estate's hub: each estate keeps that repository's docs in its own hub,
and a hub address in the repository leaks one estate into every other.
What the docs are (the document, the registry, the kinds, the code they
watch) is the same in every estate; where they live is not.

## Decision

- **The pointer.** `vantage.yaml` at the repository root names what is
  true in every estate: `document`, `decisions` (the registry of its
  records), `roadmap` and `work` (the kinds its items are), and `watch`
  (the code the docs describe). `vantage: false` alone means declined,
  never ask again. It holds no secret, and the repository keeps no
  records, roadmap, or diagrams of its own. The contract lives in the
  document (`3012`).
- **The estate's map.** `~/.config/vantage/repos.yaml` (or the file
  `VANTAGE_REPOS_CONFIG` names) is a list of `match`, `hub`, and
  `workspace`. A repository's key is its origin remote without scheme,
  user, port, or `.git`, in lower case: `git@github.com:Acme/App.git` is
  `github.com/acme/app`. A `match` ending in `/*` is a prefix. The most
  specific match wins: an exact key, then the longest prefix. An estate
  keeps its own copy and links it into place.
- **An estate's own repository.** A `hub` or `workspace` in
  `vantage.yaml` wins over the map, for a repository no other estate
  reads.
- **One resolver.** `scripts/pointer.sh` resolves both files and prints
  the result. The hook and the skills read the pointer through it.
- **The hook.** The plugin's session-start hook reads git and local files
  only: no network, no model, under a tenth of a second. It is silent
  when the repository is wired (a document and a hub), declined, outside
  a repository, and for a week after "not now". With no `vantage.yaml`
  it offers onboarding once, with the diagram files it found and their
  age against the code's, and names the hub the map gives, if any. With
  a `vantage.yaml` and no hub, it offers once to map the repository.
- **The skills.** `vantage-onboard` writes `hub` and `workspace` to the
  estate's map and the rest to `vantage.yaml`, unless the repository is
  the estate's own. `decide` adds `decisions` to `vantage.yaml` and
  finds the hub through the resolver.

## What this means for the code

- `hooks/hooks.json`, `scripts/onboard-check.sh`, and
  `scripts/pointer.sh` ship in the plugin zip.
- `scripts/pointer.test.ts` holds the key, match, precedence, and hook
  cases.

## Verification

`scripts/pointer.test.ts` runs in the check gate: remote forms (scp,
HTTPS with a user, SSH with a port), exact over prefix, a prefix that
must not match a longer name, `vantage.yaml` winning, a declined
repository, no estate file, and each line the hook says or keeps quiet.

## Consequences

- A public repository carries its docs' shape and no estate.
- A machine with no map is told once, per repository, that nothing maps
  it.
- Moving an estate's hub is one edit to its map, not a commit in every
  repository.

## Related

- [ADR-5005](5005-a-repository-points-at-its-document.md)
- [ADR-3012](3012-a-documents-docs-contract-lives-in-the-document.md)
- Platform standard 2026.1120.2003: follows
  `put-invariants-in-deterministic-hook-handlers-and-context-de` (detection
  in code, the offer in the model) and
  `keep-a-system-s-documentation-in-the-diagram-hub-tied-to-the` (one
  pointer file in an analyzed repository).
