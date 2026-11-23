/** Icons and pictures as plain data that crosses to a render thread, and the sources a render draws them from there. */
import type { Model } from '@vantage/model';
import { LayeredIconSource, MapAssetSource, MapIconSource, modelResources, type Resources } from '@vantage/render';
import { defaultIcons } from '@vantage/server';

export interface ResourceData {
  /** The version's files by the path the document names. */
  readonly files: Readonly<Record<string, Uint8Array>>;
  /** The workspace icon pack, icon id to drawn icon. */
  readonly icons: Readonly<Record<string, string>>;
  /** Changes when the files or the pack change. */
  readonly key: string;
}

export const NO_RESOURCES: ResourceData = { files: {}, icons: {}, key: '' };

/** The document's own icons, the workspace pack, then the shipped packs; pictures from the version's files. */
export function resourcesFrom(model: Model, data: ResourceData): Required<Resources> {
  return modelResources(model, new LayeredIconSource([new MapIconSource({ ...data.icons }), defaultIcons()]), new MapAssetSource({ ...data.files }));
}
