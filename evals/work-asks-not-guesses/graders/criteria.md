---
type: llm
weight: 1
---

A successful response uses the vantage-work skill. It starts from vantage_queue and reads the last handoff note on the card first. It claims the item and starts it in one vantage_item call, and never plans a heartbeat or a renew call of its own. It reads only the parts of the item it needs. Because the region is a decision only a person can make, it asks on the item with an ask action and stops instead of guessing a region. It never moves a roadmap item by hand, and it does not finish the item while the question is open. It uses no em dashes or en dashes.
