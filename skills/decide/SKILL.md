---
name: decide
description: "Write, change, supersede, or migrate decision records (ADRs) in Vantage. Use when a decision about how a system is built or run is made, changed, or reversed, or when a repository's decision records should move into Vantage."
---

# Decide

A decision record says what was decided, why, and what it costs. In Vantage
it lives in a registry beside the diagrams it governs, and a box shows the
records that govern it. Read `guide#decision-records-in-a-hub` once per
session: it has the record's text form. A record is text at its citation
(`SHOP-2001`), read and changed with the five verbs; the record tools that
are not text are called through `vantage_tool`.

## 1. Read the estate's settings

Read the file named by `VANTAGE_DECISIONS_CONFIG`, else
`~/.config/vantage/decisions.yaml`. Where it has a rule, it wins over this
skill. It names:

- `registries`: each with `prefix`, `name`, `scope` (`organization` or
  `program`), `workspace`, `when` (the words that say a decision belongs
  there), and for a program `program` and `repositories`. An entry may
  carry its own `categories`.
- `categories`: the scheme a new registry gets, digit to name.
- `timezone`: the zone for dates you send.

With no file, use the defaults: categories 0 Governance, 1 Infrastructure,
2 Security, 3 Data, 4 Compute, 5 Development, 6 Operations; dates in the
local zone of the machine. List the registries with `vantage_outline`
(no address) and ask which one fits. A fictional example ships beside this skill as
`decisions.example.yaml`.

If a registry the file names does not exist on the hub yet, make it with
`vantage_registries` (`action: create`) in its workspace, with its
categories, before you write to it.

## 2. Pick the registry

- **Organization**: the decision applies across programs, or is department
  policy.
- **Program**: the decision is unique to one program. Use that program's
  registry, in the program's own workspace, where its diagrams live. A
  program with no workspace gets one first (`vantage_workspaces`), and a
  registry that sits elsewhere moves there with `vantage_move`.

A decision is written once, in the registry of the narrowest scope it is
true for, and it stays there: this skill sends a record nowhere else. When
a program's decision must bind every program, write it in the organization
registry and relate the two records.

Infer it from the decision and the `when` lines. A repository you are
working in names its registry in `vantage.yaml` (`decisions`), and its
hub and workspace come from the pointer (`sh
"${CLAUDE_PLUGIN_ROOT}/scripts/pointer.sh"`: `vantage.yaml`, else the
estate's `repos.yaml`); without `decisions`, it maps to the program whose
`repositories` lists it. When it is
not plain, ask, with the choices and a one-line reason each.

## 3. Search before you write

Call `vantage_find` with the decision's key words and `in:` the registry,
and read the section that matters of what comes back
(`vantage_read SHOP-2001#decision`). Read a whole record only when you
will rewrite most of it.

- The decision stands and only gets sharper (more examples, a clearer
  rule, new links): **refine** it with `vantage_patch`, sending only the
  sentences that change. Last updated moves. Send `minor: true` only for
  a date or wording fix.
- The decision is reversed or replaced: **supersede** it with
  `vantage_decision_supersede`. The old record keeps its body. When the
  record that replaced it already exists, patch the old record's header
  instead: `status: superseded` with `superseded_by: SHOP-2002`.
- Nothing covers it: **create** it with a `vantage_write` to the registry
  (`SHOP`), in the record's text form. It takes the next number in its
  category; `vantage_decision_next` shows which.

On a machine with a disk, several records at once are easier as files:
`vantage_checkout` the registry, edit or add files under
`decisions/<REGISTRY>/`, and `vantage_sync`.

One decision per record. Decisions made together that can change apart get
a record each.

## 4. Write it

- **Decision makers**: the real people who decided, by name. If you do not
  know who decided, ask. Never guess, and never put a role or a team
  where a name belongs.
- **Category**: the digit whose name fits the decision's domain.
- **Dates**: the decision date, and Last updated as `updatedOn`, both as
  the local date (`YYYY-MM-DD`) in the estate's zone.
- **Context**: why a decision was needed. The forces and the facts.
- **Decision**: what was decided and what it means in practice.
- **Consequences**: `### Benefits` and `### Costs`. Both, always.
- **Alternatives considered**: every option not taken, each with why it was
  rejected.
- **Related**: records this one leans on, as `SHOP-2001`, or `ADR-2001` for
  one in the same registry.
- **Governs**: the boxes and views it decides about, one line each:
  `workspace/document box node-id`. Find ids in the document's outline.
  Every record that governs a system links to its boxes.
- **Position**: when the record sets a rule its scope's people, agents,
  or systems must follow, give it a `position:` (the rule in one line, a
  binding word, who it binds; `guide#standards`). The hub builds the
  scope's standard from these and publishes it at once. A one-off choice
  has none. Say how it stands against another standard in its Context.
- **Cite it where it applies.** Add the record to the `decisions:` list of
  each box it is about, and cite it in the pages that explain those parts
  (`[[decision:SHOP-2001]]`). The hub indexes these citations: they are
  the record's Cited by, and they are what a later move rewrites. A
  record nothing cites is one nobody finds.

Fill every section. Plain words, short sentences. No em dashes or en
dashes. Never name a person anywhere but the decision makers.

## 5. File the work it owes

A record is not done until the work it owes is on a roadmap. Do this in
the same pass as the record, before anyone writes code for it.

1. **Ask what it owes.** Something to build, change, take out, or play,
   now or later. A record that only writes down what already stands owes
   nothing; say so in your answer.
2. **Find the roadmap.** The program's `vantage.yaml` names its kinds:
   `roadmap` (outcomes, such as `SHOPR`) and `work` (parts of them, such
   as `SHOPW`). Where it names neither, the estate's settings or the
   program's own records say where its work is tracked; file it there.
3. **Find or file each item.** `vantage_find` the kind for the work
   first, and widen an item that covers it rather than add a second. A
   new item is a `vantage_write` to the kind, with what done looks like.
   A part goes under its roadmap item (`part-of`).
4. **Link both ways.** Link each item to the record
   (`vantage_item`, `link: {rel: decision}`), and the boxes it adds,
   changes, or retires. Name the items in the record's text, where it
   says what the decision means for the code.
5. **Claim what starts now.** When this conversation goes on to build
   it, claim the work item and move it to doing before the first change,
   as `vantage-work` says. Work that waits stays open.

## 6. Refactor

Renumber a record, move it to another category, or move it to another
registry, when a registry is cleaned up or reorganized. The record keeps
its id; its old citation stays an alias that resolves, and the number is
never handed out again.

1. **Read what cites it.** The record's outline ends with cited by:
   every document (with its boxes and pages) and record that cites it,
   and a count of places you cannot open.
2. **Dry run.** Call `vantage_decision_move` with the record, the target
   (a `number`, a `category` for the next number there, a `registry`, or
   a mix), and `dryRun: true`. Read the new citation, what it would rewrite, and
   what it cannot.
3. **Move** with the same arguments and a `message` saying why. Every
   citation it can write is rewritten to the new citation, as a version or
   revision by you.
4. **Read the report.** For each place it could not rewrite, tell its
   owner the new citation. The old one keeps working until they change it.
   Repoint links outside the hub (repositories, docs) the same way.

## 7. Migrate a repository

Move a repository's in-repo records into its program's registry, in one
commit.

1. **Find them.** At each project root (the repository root, and every
   `projects/*/`), look in `docs/decisions/`, `docs/adr/`, `adr/`,
   `docs/architecture/decisions/`, `records/adr/`, and `projects/*/adr/`.
2. **Pick the registry**: the program whose `repositories` lists this one;
   ask when none does. A monorepo with projects for several programs maps
   each project root on its own.
3. **Dry run.** Call `vantage_decision_import` with `dir`, the absolute
   path of the folder, and `dryRun: true`. The tool reads the files;
   never read them yourself to send their text. Read what it could not map. Where a record names no
   decision makers, or names a role or a team there, ask who decided
   before you import, and set the names after it, or report it.
4. **Import** with the same `dir`. Each record keeps its number, dates,
   status, decision makers, and supersede links, and every word the
   author wrote: lead text and a status note go into Context, Related
   prose and References keep their own headings. The answer lists each
   file with its new citation and link.
5. **Repoint links.** Search the repository for links to each moved file
   (by path, relative path, and file name) and replace them with the
   record's link from the answer. Repoint `AGENTS.md`, `README.md`, docs,
   and code comments alike.
6. **Remove the folder entirely.** Leave nothing in it: no README, no
   pointer file. A folder left behind keeps the repository flagged.
7. **Point to the registry** in `vantage.yaml` at the repository root:
   add `decisions: <PREFIX>`, or write the file with that line when there
   is none. The hub and workspace stay where the pointer already finds
   them; when nothing maps them, add the repository to the estate's
   `repos.yaml` the way `vantage-onboard` does, never to a `vantage.yaml`
   other estates read. `AGENTS.md` names the pointer and never restates a
   record.
8. **Commit** steps 5 to 7 together, as one commit, with the repository's
   own commit rules.
9. **Report** what moved (file to citation), what was already there, what
   was skipped, and everything the import could not map.

## Rules

- Discard a record only when you wrote it by mistake and nothing points
  to it yet: `vantage_decision_discard` with `dryRun: true`, then without.
  It removes the record and frees its number. It is refused once a
  document or record cites it, a record names it in related or a
  supersede link, an item links it, an old citation of it resolves, or
  anyone else has changed it. Then it is real.
- A real record is never deleted and its number is never reused, not
  even after a move. To retire a decision that was made, set its status
  to `deprecated`; to replace it, supersede it.
- Read a record before you change it, and change only what the decision
  changed.
- Cite records as `SHOP-2001` in diagrams and pages: a box's `decisions:`
  list, `[[decision:SHOP-2001]]` in prose.
