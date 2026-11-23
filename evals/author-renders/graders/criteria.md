---
type: llm
weight: 1
---

A successful run uses the vantage-author skill, writes a file with nodes, tagged relations with verb labels, and the three requested views: a relation view named context, a relation view with `paths` whose steps carry `text` so a narrative is drawn, and a `kind: sequence` view. It runs the lint or render command and reports the scores it got, and it changes the YAML in response to any notes (crossings, aspect ratio, overlaps) rather than ignoring them. It never writes coordinates or pins, never names a real person, and uses `author:` only if asked. The final message says where the file and the pictures are.
