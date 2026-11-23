# ADR-0002: The Agent Is the First Consumer, and a Local Disk Sets the Bar

| | |
|---|---|
| **Decision Date** | 2026-11-21 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-21 |

## Status

Accepted

## Audience

Anyone adding a tool, an answer, a page, a record kind, or an instruction
to Vantage, and anyone deciding whether a feature is done.

## Purpose

Settles who Vantage is built for first, and the bar every surface is held
to, so an estate can keep its diagrams, documents, decision records, and
plans in the hub without paying more than it would for files on a disk.

## Context

Agents do the work in Vantage: they write the diagrams, the pages, the
records, and soon the roadmap. People read, steer, and approve. The hub's
agent tools were still shaped as a web API with a tool per route. Each tool
sends and takes whole things.

Measured on a hub in use at v2.29.0, on 2026-11-21, in characters (a token
is about four):

| What an agent pays | Today |
|---|---|
| The tool list, 40 tools | 40,163 |
| The guide, sent whole by "read this first" | 52,157 |
| The connect instructions | 1,907 |
| Read the largest document to change one box | 88,596 |
| Change one sentence on the largest page | 24,857 read, then 24,857 written |
| Change one sentence in a record | the whole section, written again |
| Look at one view of a saved document | the whole YAML, written back as `text` |
| Bring a folder of Markdown records into a registry | every file read, then written again |
| Attach a picture | its bytes in base64, written by the model |

So an agent holds about 94,000 characters before it does any work, and a
day of ten small changes to that page costs about 250,000 characters
written. The same ten changes to a file on disk send only the old sentence
and the new one each time: a few thousand characters. Written tokens are
the dear kind.

The hub also cannot say what agents spend. A tool call logs its name and
whether it failed, and no size.

## Definitions

- **Standing cost**: what an agent holds before it works: the connect
  instructions, the tool list, and the skill descriptions.
- **Disk cost**: what the same task costs an agent on a local file with
  its own read, search, and edit tools.

## Decision

The agent is the first consumer of Vantage. A local disk sets the bar.

- **Agent first.** Every surface is designed for an agent that reads and
  writes it, then for the person who reads, steers, and approves. A
  feature is done when an agent can use it inside its budget.
- **No dearer than a disk.** Finding one fact, reading one part, or
  changing one sentence costs an agent no more than its disk cost, plus a
  small fixed part for the address.
- **Five costs are counted**: standing, learning (the guide), reading,
  writing, and turns. A call is a turn, and a turn reads the whole
  conversation again.
- **A write sends what changed.** Never the page, the section, or the file
  around it.
- **A read answers what was asked.** Every answer has a size limit. An
  answer that leaves something out names the call that reads the rest. A
  read of something that has not changed answers one line.
- **Text the agent does not need to see never passes through it.** A file
  on its disk, a picture, a folder of records: the tool moves them.
- **One call carries many.** Reads of several things, and changes to
  several things, go in one call.
- **The hub measures itself.** Every tool call records the tool, the
  characters it took, and the characters it answered. No conversation is
  named.
- **A benchmark holds the bar.** Fixed tasks run against the hub and
  against a disk, counted in characters and calls. It runs in the check
  gate.
- **Budgets come from measurement and live in one file.** A task's budget
  is its disk cost, by rule. A standing budget is first set at what the
  rebuilt surface measures. A change may lower one. Raising one is a
  decision, recorded here.
- **Tokens and money are the cost meter's.** The hub counts characters. An
  estate's cost meter stays the truth for what a conversation cost.

## What this means for the code

- One wrapper runs every tool. It logs the sizes and counts them as
  metrics by tool. No tool file keeps its own copy.
- One file holds every budget, the way `style.ts` holds every size.
- The benchmark lives beside the other benches under `scripts/bench/`, and
  its task list is data. A new kind of content adds its tasks in the same
  commit.
- A change that adds a tool, a field on an answer, or a line of
  instruction moves a number the check gate reads.

## Verification

`scripts/bench/agent-cost.test.ts` runs in the check gate. It fails on a
tool list, instructions, or skill descriptions over budget, and on a task
for a box, a view, a page, or a record that costs more on the hub than on
a disk or takes more calls. Items add their tasks when they land. An
estate's Vantage board shows calls and characters in and out by tool.

Measured when it landed, against v2.29.0: the tool list went from 40,163
characters to 7,351, the guide is no longer sent whole (52,157), and every
task costs no more than its disk cost.

## Consequences

- An estate can make the hub the home of its documents and records, and
  the cost of working there stays the cost of a folder.
- A feature may wait for its agent door before it ships.
- A tool that is easy to write, one per route with the whole thing in and
  out, no longer passes.
- The benchmark counts the cheapest path. Whether agents take it is read
  from the cost meter, and fixed in the instructions.

## Related

- [ADR-5002](5002-agents-reach-everything-through-one-text-space.md): the
  verbs that meet the bar on the hub.
- [ADR-5003](5003-an-agent-with-a-disk-works-in-a-working-copy.md): the
  laptop, where the cost is the disk's own.
- [ADR-5004](5004-an-agent-holds-a-small-core.md): the standing cost and
  the guide.
- Platform standard 2026.1120.2003: follows
  `bound-every-answer-an-agent-reads-and-let-each-answer-name-t`,
  `have-every-reader-send-a-list-s-tag-back-and-answer-an-uncha`,
  `hold-a-shared-service-to-budgets-it-enforces-itself-a-findin`,
  `set-a-budget-only-where-a-written-standard-already-states-th`, and
  `measure-agent-cost-per-conversation-from-the-agents-own-tran`. The disk
  as the bar is new ground.
