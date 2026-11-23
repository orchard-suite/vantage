/**
 * Which tools an agent always holds and which it asks for. The core is
 * listed on connect. Every other tool belongs to one group and is listed
 * and called through vantage_tool. Adding to the core changes a budget and
 * docs/decisions/5004.
 */
export const CORE: readonly string[] = ['vantage_outline', 'vantage_find', 'vantage_read', 'vantage_patch', 'vantage_write', 'vantage_render', 'vantage_validate'];

/** What a laptop adds to the core: the working copy. */
export const LAPTOP_CORE: readonly string[] = ['vantage_checkout', 'vantage_sync'];

export const GROUPS: Readonly<Record<string, { readonly about: string; readonly tools: readonly string[] }>> = {
  documents: { about: 'versions, deleting, moving, workspaces, layout candidates, exports, imports, icons', tools: ['vantage_history', 'vantage_diff', 'vantage_delete', 'vantage_move', 'vantage_workspaces', 'vantage_explore', 'vantage_export', 'vantage_import', 'vantage_icons', 'vantage_workspace_icons'] },
  review: { about: 'comments, mentions, reactions, voice walkthroughs', tools: ['vantage_comments', 'vantage_comment', 'vantage_resolve_comment', 'vantage_people', 'vantage_mentions', 'vantage_reactions', 'vantage_recordings'] },
  records: { about: 'registries, superseding, moving, and importing decision records', tools: ['vantage_registries', 'vantage_decision_supersede', 'vantage_decision_move', 'vantage_decision_import', 'vantage_decision_next'] },
  live: { about: 'connectors, drift, publications', tools: ['vantage_connectors', 'vantage_sources', 'vantage_connector_save', 'vantage_connector_run', 'vantage_drift', 'vantage_publications', 'vantage_publish'] },
  work: { about: 'tracked items: the queue, claims, moves, questions, finishing a run; bring a Markdown roadmap in', tools: ['vantage_queue', 'vantage_item', 'vantage_roadmap_import'] },
};

export function groupOf(tool: string): string | undefined {
  return Object.entries(GROUPS).find(([, g]) => g.tools.includes(tool))?.[0];
}
