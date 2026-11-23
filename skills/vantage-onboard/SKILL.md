---
name: vantage-onboard
description: "Give a repository living Vantage docs: pick a workspace, import its old diagrams or read the code, write the diagram and first pages with evidence, save, and write vantage.yaml. Use when a session says a project has none, or when asked to onboard or migrate docs."
---

# Vantage onboard

After onboarding, any agent working in the repository knows where its
truth is and keeps it current. One small file in the repository names its
document; the estate names the hub and workspace; everything else lives in
the document.

## Where the pointer comes from

Read it with `sh "${CLAUDE_PLUGIN_ROOT}/scripts/pointer.sh"`. It prints the
repository's key (its origin remote without scheme, user, port, or `.git`,
in lower case: `github.com/acme/app`), the `hub` and `workspace`, which
file gave the hub (`from`), and what `vantage.yaml` holds.

- `vantage.yaml` at the repository root holds what is true in every
  estate: `document`, `decisions`, `roadmap`, `work`, `watch`.
- The estate's `~/.config/vantage/repos.yaml` (or the file
  `VANTAGE_REPOS_CONFIG` names) maps repositories to a hub and workspace,
  most specific match first; a `match` ending in `/*` is a prefix:

  ```yaml
  - match: github.com/acme-tools/*
    hub: https://vantage.example.com
    workspace: tools
  ```

  An estate keeps its own copy and links it into place, like its other
  Vantage config.
- A `hub` or `workspace` in `vantage.yaml` wins. Only a repository that is
  the estate's own, one no other estate reads, keeps them there.

## Ask once

The session hook says when a repository has no `vantage.yaml`, or when
its `vantage.yaml` names a document but nothing maps its hub. Offer at a
natural pause, never in the middle of the person's task, in one sentence
that says what you found. Then do what they answer:

- **Yes**: go on below.
- **Not now**: write nothing in the repository. Append the repository's
  root and the time to the snooze file, and the hook stays quiet for a
  week: `printf '%s %s\n' "$(git rev-parse --show-toplevel)" "$(date +%s)" >> ~/.config/vantage/onboard-snooze`.
- **Never**: write `vantage.yaml` holding only `vantage: false`, and say
  it is there to be committed. No agent asks again.

## Steps

1. Read `guide#docs-that-stay-true`. Check the hub: `vantage_outline`
   with no address lists the workspaces. With no hub, say so and stop;
   the person signs in with `vantage login <hub url>`.
2. Name the repository as host/owner/name from `git remote get-url
   origin`, and look for a document that already describes it:
   `vantage_find "repository: <host/owner/name>"`. When one exists,
   confirm it with the person, write the pointer (step 8), and stop. When
   the repository's `vantage.yaml` already names it and only the hub is
   unmapped, step 8's estate line is all that is missing.
3. Pick the workspace. A program gets a workspace of its own for its
   diagrams, decisions, roadmap, and work; what several programs share (a
   platform, a monorepo's common parts) goes in that platform's
   workspace, with a document per program inside it. Where the person's
   own rules name the workspace, use it. Else make the program's own with
   `vantage_workspaces` (`action: create`, named for the program) and say
   so. Never put a program in the person's own workspace (`~`), and never
   in another shared workspace because its name matches or a key can
   write there.
4. Size it. A project one session can read whole (a few hundred source
   files) is onboarded here. A large legacy one needs an analysis run
   that reads it unit by unit; say so, write the pointer and the contract
   only, and let the analysis seed the document.
5. Brownfield, when the hook found diagrams: `vantage_import` each file,
   and each Markdown file with Mermaid or PlantUML blocks, into one
   scratch folder; merge them into one document. The old pictures are
   probably wrong: check every box and every arrow against the code,
   fix or drop what the code does not show, and add what it shows that
   the pictures lack. Drop the pins once a view lays out well on its own.
   Greenfield: read the entry points, manifests, deploy files, and
   workflows, and write the brief with `vantage-brief`.
6. Write the document with `vantage-author`: the views, and the first
   pages (an overview, a guide per main flow, a runbook), with the docs
   block: `kind: system`, `repository`, the `audience` the person names,
   the `pages` you wrote, and `checks: [no-copied-facts,
   sections-name-boxes]`. Tie every box and every section to the files
   you read it from at the head commit (`evidence`), then add `evidence`
   to `checks`. Every save checks the whole document and refuses errors.
7. Save it to the workspace, and validate it by address until it is
   clean and its notes are worked.
8. Write the pointer. The `hub` (the address of the link the save gave)
   and `workspace` go in the estate's `repos.yaml`, as an entry whose
   `match` is the repository's key, or a prefix that already covers it;
   leave an existing entry that already maps it alone. Only a repository
   that is the estate's own takes them in `vantage.yaml` instead.
   `vantage.yaml` at the repository root gets `document` and `watch` (the
   folders the docs describe), plus `decisions` (the registry prefix),
   `roadmap`, and `work` (kind prefixes) when the program has them. Move
   any decision records in the repository with `decide` (Migrate a
   repository). Run `pointer.sh` again and check it names the hub,
   workspace, and document. Say `vantage.yaml` is there to be committed,
   and that the estate line belongs in the estate's own copy of the
   file.
9. Offer a `git` connector for the repository with `paths` set to
   `watch` (`vantage-connect`), so merges mark what may be stale.
10. Leave the old diagram files where they are. Offer to remove them in
    a commit of their own once the person has looked at the document.

## Rules

- Never commit, push, or delete in the repository unless the person asks.
- `vantage.yaml` and `repos.yaml` hold no token and no secret.
- A repository other estates read never names a hub in its `vantage.yaml`.
- The contract lives in the document; the repository file only points.
- Answer with the document's link, as `[Name](url)`, and what is still
  unverified.
