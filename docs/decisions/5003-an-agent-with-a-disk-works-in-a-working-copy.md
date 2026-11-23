# ADR-5003: An Agent With a Disk Works in a Working Copy

| | |
|---|---|
| **Decision Date** | 2026-11-21 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-21 |

## Status

Accepted

## Audience

Anyone changing the laptop's MCP server or the `vantage` command, and
anyone writing a skill for an agent that has a file system.

## Purpose

Settles how an agent on a machine with a disk reads and writes the hub,
so its cost there is the disk's own cost
([ADR-0002](0002-the-agent-is-the-first-consumer.md)) and no file ever
passes through the model on its way to the hub.

## Context

Most agents that write to Vantage run on a laptop, beside a repository.
The plugin already runs an MCP server there with file access. It uses the
disk only to render and check local files. Every hub tool takes its
content as an argument, so the model writes it out: the YAML to save, each
page, each record of an import, each picture in base64.

Such an agent already has the cheapest tools there are. Its own read,
search, and edit are exact, and it uses them all day. The hub's verbs
([ADR-5002](5002-agents-reach-everything-through-one-text-space.md))
match them. On a laptop the hub can do better than match: it can hand the
agent real files.

## Definitions

- **Working copy**: a folder on the agent's disk that holds things from
  the hub in their text form, with a record of the version each came
  from.
- **Bridge**: the plugin's MCP server on the laptop. It has the disk and
  the machine's sign-in to the hub.

## Decision

On a machine with a disk, the agent works on files, and the bridge moves
them.

- **Checkout writes files.** The agent names a document, a registry, or
  a workspace, and a folder. The bridge writes each thing there in its
  text form: the YAML, its pages, its pictures, each record and item as a
  Markdown file. It keeps the version of each beside them.
- **The agent uses its own tools.** It searches, reads, and edits the
  files as it would any others. Those calls cost what a disk costs,
  because they are a disk.
- **Sync sends what changed.** The bridge compares each file with the
  version it came from and sends the changes. The hub merges them line by
  line, as a save does today. The answer is one line per thing: its new
  version, or the errors with their file and line.
- **A conflict lands in the file.** When both sides changed the same
  lines, the bridge writes both into the file with markers. The agent
  fixes the file and syncs again.
- **Sync pulls too.** What changed on the hub since checkout is written
  to the files the agent has not touched.
- **A path is always enough.** Every tool that takes content also takes a
  path on the laptop: a save, a write, a picture to attach, a folder of
  records to import. Every tool that makes a file can write it to a path:
  a render, an export. The model sends the path and the bridge sends the
  bytes.
- **A picture is looked at on purpose.** A render writes its PNG to a
  path and answers the quality notes. The agent opens the picture when
  the task is how the diagram looks.
- **The working copy is a copy.** The hub stays the home. A folder can be
  deleted and checked out again with nothing lost but unsynced edits.
- **An agent with no disk uses the verbs.** A hosted assistant reaches
  the same text through ADR-5002. Skills name the thing to change, and
  the instructions say which door to use.

## What this means for the code

- Checkout and sync live in `packages/mcp/src/workcopy.ts`, on the
  bridge. They call the hub's text routes (`/api/v1/text/*`) and hold no
  logic about any kind of content: the hub names every file's path.
- The record of versions is one file in the working copy. No tool reads a
  version out of a content file.
- `files: true` on the laptop adds a path beside every content argument.
  The hub's own `/mcp` never takes a path.
- `vantage_decision_import` reads a folder on the laptop. Its `files`
  argument of whole texts is for the hub door only.

## Verification

`packages/hub/src/mcp/bridge.test.ts` writes a document from its path,
checks it out, edits a page and the YAML on disk, and syncs one version;
merges a line the hub changed with one the laptop changed; writes both
sides of a conflict into the file and lands the fixed file; attaches a
picture by its path; imports a folder of records by `dir` with a call
under 300 characters; and edits and adds record files under
`decisions/SHOP/`, where a new record takes its file name from its number.
The benchmark of ADR-0002 holds a write from a path and a sync to a fixed
size, whatever the file's size.

## Consequences

- Moving a repository's records or documents into the hub costs the model
  nothing per file.
- The agent's best tools work on hub content, with no new habits.
- A working copy can be stale. Sync says so, the way a version control
  pull does.
- Unsynced edits live only on that disk. A run that dies before sync
  loses them from the hub, and the next run finds them in the folder.
- Two doors reach the same text. The address module of ADR-5002 keeps
  them the same.

Ways not taken:

- **Keep every project's records in its repository and copy them to the
  hub on landing.** Writes stay cheap. The hub copy is then read-only, a
  second copy that drifts, and nothing can be managed there.
- **Mount the hub as a file system.** No sync step. It needs a driver on
  every machine, and a hub outage freezes an editor.

## Related

- [ADR-2001](2001-agents-sign-in-through-the-hub.md): the bridge's
  sign-in.
- [ADR-3003](3003-a-page-embeds-its-documents-files.md): the pictures a
  page names by path.
- Platform standard 2026.1120.2003: follows
  `keep-a-system-s-documentation-in-the-diagram-hub-tied-to-the` and
  `write-a-skill-once-and-put-the-person-s-record-behind-a-smal`. The
  working copy is new ground.
