---
name: roadmap
description: "Plan a roadmap in Vantage at your level and the ones above and below it: outcomes, sizes, order, parts. Use to plan, prioritise, or sequence work, or to check a roadmap's health (--review)."
argument-hint: "[--review] [kind or program]"
---

# Roadmap

A roadmap is items of a kind built on the hub's roadmap item, in a
workspace. Read `guide#roadmaps` and `guide#working-with-items` once per
session: they hold the text form, the labels, and the links. Vantage is
the ledger. There is no local copy to sync and no tracker to write.

Two modes, never mixed in one pass:

- **Plan** (`/roadmap`, the default): shape what the roadmap should say,
  show it, and write it once the person says yes.
- **Review** (`/roadmap --review`): read only. Report what is unhealthy and
  write nothing.

## 1. Read the estate's rules

Read the file named by `VANTAGE_ROADMAP_CONFIG`, else
`~/.config/vantage/roadmap.md`. Where it has a rule, it wins over this
skill: how work is owned, which levels exist, the sizing calibration, who
delivers and how much they can carry, and dates nothing may start before.
A fictional example ships beside this skill as `roadmap.example.md`. With
no file, use this skill alone.

## 2. Find where you stand

1. `sh "${CLAUDE_PLUGIN_ROOT}/scripts/pointer.sh"` names the hub, the
   workspace, and what `vantage.yaml` holds. `roadmap:` is this
   repository's roadmap kind, `work:` its work kind.
2. `vantage_outline <KIND>` lists the kind: its labels, its items, the
   kinds it takes as parts (`parts may be`), and the kinds that take it as
   a part (`part of`). That is the ladder:
   - **Up**: each kind in `part of` is the roadmap above. Outline it, and
     read its kind document's `description`: it states who may add an
     item there and from what (a decision record, a portfolio review).
     Follow that rule.
   - **Down**: each kind in `parts may be` is a level below, often in
     another program's workspace.
3. An argument names a kind or a program: start there instead. In a
   repository that only holds a suite's or a platform's documents, the
   pointer's `roadmap:` is the top of the ladder.
4. No `roadmap:` and no argument: say what is missing and offer to make
   the kind (step 6). Never guess a kind from a repository's name.

A level you cannot see (no grant to its workspace) is normal. Say which,
and plan around it.

## 3. Read before you plan

- Read the level you plan at as rows: `vantage_outline KIND` and
  `KIND#now`, `KIND#next`, `KIND#later`. Read an item's card only when you
  will change it or need its parts.
- Read the level above for the items this program is a part of, or should
  be, and the level below for the parts of the items you will touch.
- Read the conversation and anything the person gave you (notes, a
  strategy, a stale list). Never ask again for what is already there.
- Search before you make anything: `vantage_find` the outcome's key words
  `in:` the kind. Running the skill twice must never make an item twice.

## 4. Shape the plan

Each step is a proposal the person can change, never a silent choice.

1. **Place each item at its level, in its owner's kind.** A suite or
   platform item says what the suite owes and who owes it. A program item
   says what the program delivers. Work items are what an agent picks up.
   Apply the estate's ownership rules first when it has them.
2. **Give every item an outcome.** The body says what done looks like, in
   words a person outside the team could check: what they see, count, or
   can now do. When an item has none, ask until it does, or cut it: What
   does done look like? Who notices when it lands? What breaks if it
   never does?
3. **Argue against the plan.** Reread it as a contrarian. Merge near
   duplicates. Cut scope the outcome does not need. Name an item larger
   than its outcome. Flag one that boils the ocean.
4. **Size the leaves.** `size` is `XS` to `XL` on the agent path: `XS` one
   known edit, end to end in about an hour; `S` a contained change in one
   surface; `M` several moving parts, or one unknown first; `L` a feature
   across a service and its pages; `XL` architecture across several
   surfaces. Work people do by hand is sized by its owner, never on these
   bands. A parent's size is its parts', so a parent with parts carries
   none. With nothing better: an undecomposed outcome is `XL`.
5. **Break up every `XL`.** It is an outcome wearing a task's name.
   Propose its parts, in the kind below. Two exceptions: it already has
   parts in another program's kind, or the level is a register of whole
   commitments by its own rule.
6. **Order it.** A `waits-on` link says an item cannot start before
   another. `horizon` says when: `now` is being worked or next to start,
   `next` follows it, `later` is everything else. Inside `now` and `next`,
   put the items in the order they should be worked with `place`
   (`{"item": "PLAN-4", "place": "first"}`, then `{"after": "PLAN-4"}` for
   each one after it); every list, board, and outline shows that order.
   An order never contradicts a `waits-on`. Detail follows the horizon:
   `now` gets parts down to work items, `next` gets parts where they are
   settled, `later` stays one item. An item with no date is `later` until
   someone says otherwise.
7. **Dates only from people.** `promised` is set only when someone
   promised it. `start` and `end` are the plan, set only from what a
   person said or from capacity the estate's rules state (how much each
   owner can carry, laid along the order and the `waits-on` links). Never
   invent one, and never fill dates to make a timeline look whole. Set
   them on the leaves: a parent's span is worked out from its parts. When
   the estate's rules name a date nothing may start before, nothing in the
   plan may start earlier, and that date is a floor, never a value to copy
   onto everything. When they name how much each owner can carry, check
   the `now` horizon against it and say which owner is over. Without such
   a number, say that capacity was not checked, and set no `start` or
   `end` a person did not give.
8. **Phases are milestones.** Where a set of items must land together by
   a date, propose a milestone: its `date`, and a body saying what must be
   true by then. Link each item `toward` it, from any kind or program. Its
   card says on track or at risk, and which items put it at risk. A
   milestone's date comes from a person, like every date. A program with
   no milestone kind gets one in its workspace (step 6).
9. **Tie it to the picture and the record.** Link the decision an item
   came from (`decision`), the boxes it `adds`, `changes`, or `retires`,
   and its proof once work exists. A suite item becomes `part-of` nothing;
   a program item is `part-of` the suite item it serves.

## 5. Show it, then write it

Show the whole change as one table before writing anything:

| Item | Level | Change | Horizon | Place | Start to end | Size | Waits on | Part of | Toward |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Then the items that still need an answer from the person, and why. Write
only after the person says yes, and only what they agreed to:

- A new item: `vantage_write` to the kind's prefix, with `title`,
  `labels`, `parent` (the item it is part of), and the outcome as its
  body. On a laptop, many items at once: `vantage_checkout` the prefix
  and write files under `work/<KIND>/`, then `vantage_sync`.
- A change: `vantage_patch` the title, a label, or the body.
- Links, holders, an order, and a drop: `vantage_item` actions, many in
  one call (`waits-on`, `part-of`, `toward`, `decision`, `proof`, `adds`,
  and `place`).
- Never set a state. A roadmap item moves by its proof. With no machine
  proof, an item can only be reported done, with a note naming what
  proves it.
- Never drop, remove, or reword an item the person did not name in this
  conversation. A divergence you found is reported, not fixed.

## 6. A program with no roadmap kind

Make one in the program's workspace (a program with no workspace gets one
first, `vantage_workspaces`): a document with a `kind` block, `base:
roadmap-item`, a prefix that is the program's registry prefix plus `R`,
and the label `size` (the base brings `horizon`, `promised`, `start`, and
`end`). Add its work kind to `parts` when it has one. Add the new prefix
to the `parts` of the kind above it, so the ladder holds both ways. Write
`roadmap:` into the repository's `vantage.yaml`. A prefix never changes
once it has items.

A program that needs a milestone and has no milestone kind gets one in
its workspace the same way: a document with a `kind` block, `base:
milestone`, and a prefix that is the program's registry prefix plus `M`.

## 7. Review

`/roadmap --review` reads the ladder from where you stand and reports, as
one table per level:

- items with no outcome, or an outcome no one outside could check;
- `now` items with no size, or with no parts when they are `L` or `XL`;
- an `XL` with no parts;
- a `waits-on` that loops, or points at something dropped or shipped late;
- a `now` item waiting on a `later` one, or placed before an item it
  waits on;
- a milestone at risk, with the items that put it there;
- items no proof has moved in a long time while `now`;
- items with no decision where the level's rule needs one;
- accepted decision records in the program's registry that owe work and
  that no item links (`decision`), newest first: the work a decision
  promised and nobody filed;
- items in `doing` that no one holds, and work in the repository's recent
  commits that names no item;
- program items that serve nothing above, and suite items with no parts in
  the program that owes them.

End with what you would change, as a plan the person can say yes to.

## 8. Report

What changed, level by level: made, changed, linked, left alone, and what
still needs the person. Give the board's link,
`<hub>/w/<workspace>?tab=work&kind=<KIND>`, as `[Name](url)`. Say plainly
whether running the skill again would change anything.

## Gaps

When planning needs something the hub cannot hold (a budget of hours),
say so, plan without it, and note it as a gap for Vantage's own roadmap.
Never work around it with a label that pretends to be the missing thing.
