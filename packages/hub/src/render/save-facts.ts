/**
 * What a save takes from its document's model, read on a render thread in
 * the same pass as the check. The check has just parsed the text there, so
 * the save parses it once, and never on the event loop that answers
 * requests.
 */
import type { Document } from '@vantage/model';
import { documentFiles, MapAssetSource } from '@vantage/render';
import { documentCites, type Cite } from '../decisions/citations.ts';
import { loadedSources, loadStored, searchText, type ImportMap } from '../documents/model.ts';

export interface SaveFacts {
  readonly title: string | undefined;
  /** The search text that follows the document's name, which the save knows and puts in front. */
  readonly searchAfterName: string;
  /** The files the document names; null when it does not parse, and every file is kept. */
  readonly files: readonly string[] | null;
  /** The sources it draws from, by slug. */
  readonly binds: readonly string[];
  readonly cites: readonly Cite[];
  /** The document as written, when it defines a kind: registering the kind reads its views. */
  readonly kindDocument?: Document;
  readonly diagnostics: number;
}

export function saveFacts(yaml: string, imports: ImportMap, files: Readonly<Record<string, Uint8Array>>): SaveFacts {
  const loaded = loadStored(yaml, imports);
  const model = loaded.model;
  const assets = new MapAssetSource({ ...files });
  const pages = Object.fromEntries(Object.entries(files).filter(([path]) => /\.md$/i.test(path)));
  return {
    title: model?.title,
    searchAfterName: searchText(model, ''),
    files: model ? documentFiles(model, assets) : null,
    binds: loadedSources(loaded),
    cites: documentCites(model, pages),
    ...(loaded.document?.kind ? { kindDocument: loaded.document } : {}),
    diagnostics: loaded.diagnostics.length,
  };
}
