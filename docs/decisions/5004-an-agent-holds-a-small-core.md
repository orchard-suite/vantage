# ADR-5004: An Agent Holds a Small Core and Learns the Rest When It Needs It

| | |
|---|---|
| **Decision Date** | 2026-11-21 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-21 |

## Status

Accepted

## Audience

Anyone adding a tool, changing the connect instructions, the guide, or a
skill, or wording an error an agent reads.

## Purpose

Settles what an agent holds before it does any work, and how it learns
the rest, so a conversation that only reads one record does not pay for
the whole product.

## Context

Standing cost is paid by every conversation that connects, whatever it
does ([ADR-0002](0002-the-agent-is-the-first-consumer.md)). Measured on
a hub in use at v2.29.0, in characters:

- The tool list is 40 tools and 40,163. Six whole-thing tools (create,
  update, and supersede a record; edit, save, and page) are 17,279 of it.
  Create and supersede repeat the same eleven fields.
- The connect instructions are 1,907. They teach how to save a diagram.
  They do not teach how to read or change a small part.
- `vantage_guide` says "read this first" and answers 52,157: every view
  kind, connectors, imports, comments, and records, to an agent that came
  to fix one sentence.
- `vantage_schema` answers 32,035.

Many hosts put every tool into the model on every turn. A host that loads
tools on demand loads the whole list when an agent searches for "vantage".

## Decision

An agent holds a small core. Everything else is one call away, by name.

- **The core is the five verbs and what looks at a diagram.** Outline,
  find, read, patch, write
  ([ADR-5002](5002-agents-reach-everything-through-one-text-space.md)),
  render, and validate are always listed.
- **Every other tool is listed on demand.** Comments, reviews,
  recordings, connectors, publications, icons, exports, history, record
  moves and imports, and tracking's actions are found through one tool
  that lists them by group, and called through it. A host that already
  loads tools on demand may list them all.
- **The instructions teach the climb.** Outline, then find, then read
  the part, then patch. Never read a whole thing when a part answers.
  Never write a whole thing when a patch does. Put many in one call. They
  are a few lines, sent once on connect, and skills point at them.
- **The guide is text at an address.** Its outline lists its topics with
  sizes. An agent reads the topic its task needs. No tool says "read this
  first".
- **The schema is read by part.** One type, one view kind, one enum.
- **A refusal teaches.** An error names what was wrong, the line, the fix
  when there is one, and the guide topic that explains the rule. An agent
  learns a rule when it breaks it, not before.
- **A description is short.** A tool says what it does and when to use it
  in a sentence or two. How to use it well is in the guide.
- **Shared fields are written once.** Two tools never carry the same
  field list.
- **A skill never copies the guide.** It says what to do and names the
  topics to read.
- **Standing cost has a budget.** The core list, the instructions, and
  the skill descriptions each have a ceiling in the budget file, and the
  check gate reads them.

## What this means for the code

- The core list is one array. Adding to it changes a budget and this
  record.
- `docs/agent-guide.md` stays one file and the only copy. Its headings
  are its topics. A heading added or renamed is a topic added or renamed.
- Every error an agent can receive carries a topic. A test walks the
  error codes and fails on one with none.
- The groups are one table, `packages/mcp/src/catalog.ts`. A tool in no
  group fails a test. The door in front of the tools,
  `packages/mcp/src/front.ts`, is the same on the hub and the laptop, and
  it is where each call is measured.

## Verification

The benchmark of ADR-0002 measures the core list, the instructions, the
skill descriptions, and "change one sentence in a record" from a fresh
connection, everything it was sent, against their budgets.
`packages/hub/src/mcp/mcp.test.ts` calls a tool through `vantage_tool`
and by its own name and gets the same answer.
`packages/mcp/src/topics.test.ts` fails on an error code with no topic, or
a topic the guide does not have.

The hosts in use all pass the instructions to the model: Claude Code puts
them in the conversation, VS Code attaches them to the server's tools, and
Codex reads them and asks that the first 512 characters stand alone.

## Consequences

- A conversation that reads one record pays for seven tools and a few
  lines, not for the product.
- An agent that writes its first sequence view reads that topic, and
  never the pages on connectors.
- A long-tail tool costs one more call the first time it is used.
- Errors carry more words than before. They replace reading the guide up
  front.
- The guide's headings become names agents rely on.

Ways not taken:

- **Leave the list whole and trust hosts to load tools on demand.** Costs
  nothing to build. Hosts that load everything pay on every turn, and a
  search by name still loads the whole list.
- **Split the product into several MCP servers.** Each list is small. A
  person then installs and signs in to several, and an agent must know
  which server holds what.

## Related

- [ADR-2001](2001-agents-sign-in-through-the-hub.md)
- Platform standard 2026.1120.2003: follows
  `bound-every-answer-an-agent-reads-and-let-each-answer-name-t` (the
  climb sent as the server's own instructions) and
  `skills-in-the-agent-plugin-read-the-rules-from-the-hub-and-n`.
