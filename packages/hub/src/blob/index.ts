import type { Config } from '../config.ts';
import type { Logger } from '../log.ts';
import type { BlobStore } from './blob.ts';
import { fsBlobStore } from './fs.ts';
import { azureBlobStore } from './azure.ts';

export type { BlobStore } from './blob.ts';
export { memoryBlobStore } from './blob.ts';

export async function openBlobStore(config: Config, log: Logger): Promise<BlobStore> {
  if (config.BLOB_DRIVER === 'azure') return azureBlobStore(config.AZURE_BLOB_URL!, log);
  return fsBlobStore(config.BLOB_PATH, log);
}
