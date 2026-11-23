/**
 * What every agent is told when it connects, by the hub and by the laptop
 * bridge alike. The first paragraph stands alone: some hosts read only
 * that much. Skills point here and do not repeat it.
 */
const LEAD =
  'Vantage holds diagrams (YAML), pages (Markdown), and decision records as text at addresses: workspace/document, workspace/document/pages/x.md, SHOP-2001. Climb: vantage_outline (names and sizes), vantage_find (lines), vantage_read (one part, address#part), vantage_patch (swap one exact string). Never read a whole thing when a part answers. Never write a whole thing when a patch does. Put many reads or edits in one call.';

const REST = [
  'The language and the rules are at the address guide: outline it, read the topic the task needs. A refusal names its topic.',
  'Before you say how a system or standard works, vantage_find it here. When a decision changes it, patch the smallest part now wrong.',
  'Save what a person asked for before you answer (vantage_write to ~ is their own workspace) and answer with the link, as [Name](url).',
  'Comments, history, connectors, publishing, and record moves are listed by vantage_tool.',
];

const LAPTOP = 'On this machine you have a disk. For more than a line or two, vantage_checkout into a folder, edit the files with your own tools, and vantage_sync. Give a path wherever a tool takes content.';

export function agentInstructions(opts: { readonly laptop?: boolean } = {}): string {
  return [LEAD, ...REST, ...(opts.laptop ? [LAPTOP] : [])].join('\n');
}

export const INSTRUCTIONS_LEAD = LEAD;
