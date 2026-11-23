# ADR-5005: A Repository Points at Its Document, and a Hook Offers Onboarding Once

| | |
|---|---|
| **Decision Date** | 2026-11-22 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-22 |

## Status

Superseded by [ADR-5006](5006-the-estate-maps-a-repository-to-its-hub.md)

## Audience

Anyone changing the plugin's hooks, the onboarding skill, or the pointer
file a repository carries.

## Purpose

Settles how an agent working in a repository learns where its docs live,
and how a repository with none gets offered them.

## Context

A skill cannot start itself. Without something in the repository, an agent
cannot tell "set up", "not set up", and "declined". Analyzed repositories
are often ones nobody wants to change beyond one file.

## Decision

- **The pointer.** `vantage.yaml` at the repository root names `hub`,
  `workspace`, `document`, `decisions` (the registry of its records),
  `roadmap` and `work` (the kinds its items are, when it has them), and
  `watch` (the code the docs describe). It holds no secret, and it is all
  the repository keeps of them: records, roadmap, and diagrams live in the
  hub. `vantage: false` alone means declined, never ask again.
  The contract lives in the document (`3012`).
- **The hook.** The plugin's session-start hook runs a shell script that
  reads git only: no network, no model, under a tenth of a second. It is
  silent when the file exists, outside a repository, and for a week after
  "not now". Otherwise it prints one line: no docs, or the diagram files
  it found (draw.io, Visio, Lucidchart, Mermaid, PlantUML, Structurizr,
  Ilograph, architecture pictures in `docs/`) with their age against the
  code's.
- **Every repository.** The hook runs in every repository; "never" is one
  word.
- **The skill.** `vantage-onboard` asks once, finds a document that
  already names the repository, else picks a workspace, imports old
  diagrams (Mermaid and PlantUML included) and checks every box against
  the code, or reads the code fresh, writes the document with evidence,
  saves, writes the pointer, and leaves old files alone.

## What this means for the code

- `hooks/hooks.json` and `scripts/onboard-check.sh` ship in the plugin zip.
- The import package reads Mermaid and PlantUML, as files and as blocks in
  Markdown.

## Verification

The script was run across every repository on a development machine: silent
outside repositories, one line in each without a pointer, under 0.1
seconds.

## Consequences

- Every project touched for the first time is offered docs once.
- Throwaway clones are offered too, and answered with one word.

## Related

- [ADR-3012](3012-a-documents-docs-contract-lives-in-the-document.md)
- Platform standard 2026.1120.2003: follows
  `put-invariants-in-deterministic-hook-handlers-and-context-de` (detection
  in code, the offer in the model) and
  `keep-a-system-s-documentation-in-the-diagram-hub-tied-to-the` (one
  pointer file in an analyzed repository).
