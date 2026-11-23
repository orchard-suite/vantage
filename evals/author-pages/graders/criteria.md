---
type: llm
weight: 1
---

A successful run uses the vantage-author skill and adds a `kind: doc` view to the document with `file:` under `pages/` and `beside: requests`, and writes that Markdown page. The page names every box it talks about with `[[id]]` (or `[words](node:id)`), using ids that exist in the document (customers, vnet, checkout-api, payments-db, retry-queue, card-processor). It answers the questions asked by naming boxes, not by typing their facts.

The run fails if any of these is true:
- The page types a fact a box already carries: `10.40.0.0/16`, `eastus2`, `P2v3`, `GP_Gen5_4`, or `35 days` appear in the page's prose.
- The page names a box, view, or heading that does not exist, or the final lint reports a `doc-unknown-target` or `doc-file-missing` error.
- The final lint reports a `doc-copied-fact` note that the run left unfixed.
- The run never ran the lint command, or it ran it and ignored errors or page notes it reported.

It never writes coordinates and never names a real person. The final message says where the document and the page are.
