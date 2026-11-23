/**
 * What may be stale in a document, as text at workspace/document/stale:
 * its evidence ties read against the history a git connector last kept for
 * its repository. Worked out on every read, so a save that moves a tie to
 * the head clears it at once, and nothing is stored that could drift.
 */
import { parseDocumentText, staleMarkdown, staleTies, type DocsContract, type EvidenceTie } from '@vantage/model';
import type { AppContext } from '../context.ts';
import { readHistory } from '../sources/history.ts';

/** The page address a document's stale list is read at. No attached file can take it: it has no extension and lies outside artifacts/. */
export const STALE = 'stale';

export interface StaleAnswer {
  readonly text: string;
  /** How many ties may be stale; undefined when there is nothing to compare. */
  readonly count?: number;
  /** What the answer was read against, for the version a reader holds. */
  readonly head?: string;
}

function docsOf(yaml: string): { docs?: DocsContract | undefined; evidence: readonly EvidenceTie[] } {
  const d = parseDocumentText(yaml).document;
  return { docs: d?.docs, evidence: d?.evidence ?? [] };
}

export async function staleOf(ctx: AppContext, orgId: string, address: string, yaml: string): Promise<StaleAnswer> {
  const { docs, evidence } = docsOf(yaml);
  if (!evidence.length) return { text: `${address} records no evidence, so nothing can go stale. Tie each box and page section to the files it came from: evidence (guide#docs-that-stay-true).` };
  if (!docs?.repository) return { text: `${address} has ${evidence.length} evidence ties and no docs.repository to read them against. Name it: docs: { repository: host/owner/name }.` };
  const history = await readHistory(ctx, orgId, docs.repository);
  if (!history) return { text: `The hub has no history for ${docs.repository}. A git connector that reads it keeps one (vantage_tool lists vantage_connector_save; guide#docs-that-stay-true).` };
  const stale = staleTies(evidence, history.commits);
  const text = staleMarkdown(stale, {
    document: address,
    repository: history.repository,
    branch: history.branch,
    head: history.head,
    ties: evidence,
    fix: (i, head) => `When it is right again: vantage_patch { address: ${address}, op: set, path: evidence.${i}.commit, value: ${head.slice(0, 7)} }.`,
  });
  return { text: `${text}\n\nRead from the history ${history.source} kept at ${history.observed}.`, count: stale.length, head: history.head };
}
