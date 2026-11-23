---
name: vantage-work
description: "Work a Vantage hub's tracked items as an agent: take one from the queue, claim it, do it, ask a person when stuck, and finish the run with a record and a handoff note. Use when asked to pick up, work, or finish an item."
---

# Work an item

An item is tracked work in a hub: a key (`SW-12`), a state its kind's
lifecycle moves it through, and the people and runs that hold it. Read
`guide#kinds-and-items` once per session for the text form and the moves.

## Take one

1. `vantage_queue` (through `vantage_tool`, group work) lists what you may
   pick up, oldest first. Each card names what to read first, with sizes,
   and the last run's handoff note. Read the handoff before anything else.
2. Claim the item and start it in one call:

   ```json
   {"actions": [{"item": "SW-12", "claim": true}, {"item": "SW-12", "move": "doing"}]}
   ```

   A claim lasts 20 minutes. Every call you make on the item renews it,
   and on a laptop the bridge renews it while your session lives. Never
   send a heartbeat yourself. If the claim is refused, another run holds
   the item: take the next card.
3. Read the item (`vantage_read SW-12`) and only the parts you need: the
   state's page, `SW-12#notes`, `SW-12#files`. Its card names the moves
   open to you; a refused move names them too, so you never read the
   lifecycle first.

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
