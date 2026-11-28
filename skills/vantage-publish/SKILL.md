---
name: vantage-publish
description: "Publish a diagram set where people already read it, fresh on every change: SharePoint, a storage account, a git repository, Confluence, Teams, or an embed. Use when asked to publish, share, or export on a schedule, or to stop a copy going stale."
---

# Vantage publish

A publication says which document, which views, which formats, where, when,
and for whom. The hub runs it on save, on a schedule, on demand, or when you
call `vantage_publish` (the publication tools are called through
`vantage_tool`). Every artifact carries a stamp: version, publish
date, and the live link back to the hub, so a copy can always say where the
fresh one is.

## Choose the form by where people look

| Reader | Give them | Target |
|---|---|---|
| Anyone signed in to the hub | The live link, nothing to publish | none |
| A wiki page that can embed an iframe (Confluence, Backstage, Notion, a SharePoint embed web part) | The embed URL `/embed/<workspace>/<doc>/<view>` | none |
| SharePoint pages and libraries | PNG, SVG, PDF in a library; interactive HTML on a storage account static site, embedded | `sharepoint` plus `azure-blob` |
| A docs repository or GitHub Pages | HTML and PNG committed | `git` |
| A channel that wants to know | A card with the live link | `teams` |
| A client outside the org | A guest link with expiry, or the standalone HTML; where the hub turns guest links off, an export by hand | hub guest link |
| Someone who must edit in their tool | `drawio` or `vsdx` | any file target |

The standalone HTML refreshes itself: opened where the hub is reachable, it
fetches the newest version and swaps it in; offline, it shows its embedded
copy and its publish date.

## Steps

1. Ask what the reader opens today. That decides the target and the format.
   Do not publish three formats when one is read.
2. Write the publication. Secrets go in by reference (`secret: sas`), never
   by value; the hub resolves references from its secret store or workload
   identity. Ask the operator to add the secret in the hub if it is missing.
3. Where the hub requires approval, a new publication waits for an admin
   (`vantage_publications` shows `approval=pending`), and so does one whose
   target, config, formats, views, document, trigger, or audience changed.
   Tell the operator an admin approves it on the hub's Admin page; do not
   retry until then. A publication an admin stopped (`approval=stopped`)
   stays stopped until an admin lets it run.
4. Run it once by hand (`vantage_publish` with the publication id, or
   `vantage publish <file> --target fs --to <dir>` locally) and check the run
   log: written, skipped, and why.
5. Set the trigger: `on-save` for places that should never be stale,
   `schedule` with a cron (read in the hub's time zone) for places that rate limit, `manual` for releases.
6. Tell the operator the destination path or URL and the trigger.

## SharePoint note

Modern SharePoint does not run script from uploaded HTML. Publish images and
PDFs to the library, and put the interactive HTML on a storage account static
website, then embed that URL on the page. The tenant must allow the storage
host in its embed policy; say so when you set it up.
