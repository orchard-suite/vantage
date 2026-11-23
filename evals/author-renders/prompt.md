---
max_turns: 20
allowed_tools: [Read, Glob, Grep, Write, Edit, Skill, Bash(bun *)]
tags: [author]
---

Write a Vantage diagram file at /tmp/vantage-eval/portal.vantage.yaml for this system: shoppers use a web portal; the portal calls an orders API; the API reads and writes a Postgres database and publishes order events to a queue; a worker consumes the queue and emails receipts through an external email service. Make two relation views (context, then requests with a numbered path and narrative) and one sequence view of placing an order. Validate and render it with the CLI at packages/cli/src/main.ts in this repository, look at the result, and fix anything the notes report before you finish.
