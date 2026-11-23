# ADR-3014: A Topic Document Keeps a Decision Log, and Only a Decision Changes It

| | |
|---|---|
| **Decision Date** | 2026-11-22 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-22 |

## Status

Accepted

## Audience

Anyone writing the agent instructions or the guide on documents with no
repository.

## Purpose

Settles how knowledge that comes out of conversations, with no repository
to hold it, reaches a document and stays small.

## Context

Standards, access models, and concepts are settled in conversations. No
repository holds them, so the knowledge stayed in a chat. Agents that
capture everything would grow a document by a paragraph per chat.

## Decision

- A topic document sets `docs.kind` (standard or concept) and names no
  repository.
- It keeps a `decision-log` page: one entry per decision, with the date,
  what was decided, why, and when to undo it, citing a decision record
  where one exists.
- Every agent is told on connect: before you say how a system or standard
  works, find it in Vantage; when a decision changes it, patch the
  smallest part now wrong.
- Only a decision changes a topic document.

## What this means for the code

- `packages/mcp/src/instructions.ts` carries the line, inside the
  instructions budget (`5004`).
- `guide#docs-that-stay-true` holds the convention.

## Verification

The agent-cost benchmark measures the instructions against their budget.

## Consequences

- An agent in any repository finds the standard it is about to explain.
- Over-capture is held off by a rule the agent reads, not by a check.

## Related

- [ADR-3012](3012-a-documents-docs-contract-lives-in-the-document.md)
- [ADR-5004](5004-an-agent-holds-a-small-core.md)
