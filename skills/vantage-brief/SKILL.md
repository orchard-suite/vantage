---
name: vantage-brief
description: "Find the story before anything is written: the questions, one-sentence answers, the gesture and hero per view, the facts boxes carry, and the pages a set needs. Use when someone asks for a diagram, docs, a runbook, a wiki, or documentation."
---

# Vantage brief

A diagram is a picture that tells a story, and its pages are the words
that walk it. The brief is the story before either is written. Write it
first; the YAML and the Markdown then fall out, and the operator can
correct the story while it is still cheap.

## Steps

1. Read the vocabulary for step 4 once per session:
   `vantage_read guide#gestures-the-shape-of-the-sentence` and
   `guide#the-arc-of-a-diagram-set`. Read no more of the guide than
   that; the author skill reads the rest by topic.
2. When the document has a `docs` contract, read it first: its pages,
   audience, and rules are the bar the brief meets. Gather evidence.
   Diagrams and pages come from code, config, manifests, Terraform,
   workflows, ADRs, tickets, and what the operator says. Never from what
   is plausible. List the sources you read.
3. Write the questions. One view answers one question. Order them as an
   arc: context (who and why), then the main flow, then structure, then
   slices (identity, network, delivery, cost, DNS), then processes
   (sequences, flows). A set has as many views as questions, usually five
   to twelve.
4. For each question, write the one-sentence answer and pick the gesture
   the sentence wants (flow, peers, mirror, ring, tiers, outline, matrix,
   inventory, highlight, overlap, path, page). Name the hero of the view:
   the one box, path, or highlight that is the point. Everything else is
   quiet.
5. For each view, list the participants (only what the sentence names),
   the facts the boxes must carry (what the reader asks next: ids, cost,
   addresses, owners, counts), and the notes or callouts that explain a
   surprise.
6. Write the pages. A page answers what a picture cannot: why, how to do
   a task, what to do when it breaks. Per page: its reader, the question
   it answers, the view it walks (`beside`) or embeds, the boxes each
   section names, and its anchors. Usual pages: an overview, a guide per
   main flow, a runbook, a reference. A page never repeats a box's facts;
   it names the box.
7. Show the brief to the operator as two short tables: views (view,
   question, answer, gesture, hero) and pages (page, reader, question,
   view). Ask only about what changes the work.

## Output

A markdown brief with: sources read; the view table; per view the
participants, facts, and notes; the page table with each page's sections.
Hand it to `vantage-author`.

## Taste rules

- A view that needs two sentences is two views, or a page.
- Facts beat labels. A subscription box that says its cost center and
  address space is worth a whole table elsewhere.
- Color means one thing per view: a path, a role, a kind. Never decoration.
- The operator's phrasing is the title. Their question is `question:`.
