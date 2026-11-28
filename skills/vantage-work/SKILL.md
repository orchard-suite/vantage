---
name: vantage-work
description: "Work a Vantage hub's tracked items as an agent: find or take one, claim it, do it, ask a person when stuck, and finish with a record and a handoff note. Use when asked to pick up or finish an item, and before building anything in a repository whose vantage.yaml names a work kind."
---

# Work an item

An item is tracked work in a hub: a key (`SW-12`), a state its kind's
lifecycle moves it through, and the people and runs that hold it. Read
`guide#kinds-and-items` once per session for the text form and the moves.

## Take one

1. `vantage_queue` (through `vantage_tool`, group work) lists what you may
   pick up, oldest first: what an item's owner delegated to agents acting
   for your person or to you, and what a role you hold waits on. Each card
   names what to read first, with sizes, and the last run's handoff note.
   Read the handoff before anything else. Past the item and its state's
   page, read-first climbs: the item's parent and each roadmap item
   above it, every decision the item and that chain link, and the
   standard edition for its scope (`standard/payments@4`). Read the
   outcome you serve and the decisions that bind you before you change
   anything; a card cut short names the read that goes on. An item
   nobody delegated is not offered; take one only when your person asks
   you to.
2. Claim the item and start it in one call:

   ```json
   {"actions": [{"item": "SW-12", "claim": true}, {"item": "SW-12", "move": "doing"}]}
   ```

   A claim lasts 20 minutes and belongs to your run: on a laptop, the
   bridge's session. Every call you make on the item renews it, and the
   bridge renews it while your session lives. Never send a heartbeat
   yourself. If the claim is refused, another run holds the item, even
   when it acts for the same person: take the next card.
3. Read the item (`vantage_read SW-12`) and only the parts you need: the
   state's page, `SW-12#notes`, `SW-12#files`. Its card names the moves
   open to you; a refused move names them too, so you never read the
   lifecycle first.

## Start from a conversation

Work a person asks for in a conversation is tracked work too, and it is
tracked before its first change, not after it lands.

1. **See who else is here.** Read the repository's `vantage.yaml`. List
   its work kind's items in `doing` (`vantage_outline SW`): each names
   who holds it. One that covers your work, or the same files, belongs
   to another run. Tell that run, or the person, before you start.
2. **Find or file the item.** `vantage_find` the kind for the work. With
   none, write one (`vantage_write` to the kind), under its roadmap item
   (`part-of`), linked to the record that decided it (`decision`), with
   your person as its `owner` unless its scope's steward answers for it.
   Your person delegates it to you, or you delegate it for them when they
   ask: `{"item": "SW-12", "delegate": true}`. A
   decision made in this conversation is recorded first, with `decide`.
3. **Claim it and start it**, in one call, as in "Take one".
4. **Name it in every commit.** Where `vantage.yaml` names a `work` kind,
   each commit message ends with a trailer naming the item, or the
   roadmap item it is part of: `Work: SW-12`, one trailer per item, in
   the message's last paragraph. The repository's commit rules may
   refuse a commit without one. When the `git` connector reads the
   commit, the hub links it to the item as proof, so a commit a person
   lands counts as well as yours.

## While you work

- Change the item's body, title, or labels with `vantage_patch`; never
  write the whole item to change a line. On a laptop, `vantage_checkout`
  of the kind's prefix gives you its items as files under `work/<KIND>/`.
- Note what the next person would want to know: `{"item": "SW-12", "note": "..."}`.
- Stuck on a decision only a person can make? Ask on the item:
  `{"item": "SW-12", "ask": "Which region holds the cache?"}`. The item
  waits for an answer and leaves the queue. Stop; do not guess.

## Finish

One action ends the run: the run record, the move, and the release.

```json
{"actions": [{"item": "SW-12", "finish": {
  "move": "review",
  "summary": "Cached the price list behind the API.",
  "proof": ["commit abc1234", "https://ci.example/runs/88"],
  "handoff": "The cache warms on deploy; check the miss rate after release.",
  "seconds": 640,
  "cost": {"amount": 0.42, "currency": "USD", "tokens": 81000}
}}]}
```

- `summary` and `handoff` are at most 2,000 characters each; attach a
  longer account as a file.
- Report the cost your runtime reported, never an estimate.
- A roadmap item is never moved by hand: link its proof, and the hub
  moves it when the proof lands.
