/**
 * Blob store on an Azure Blob container. AZURE_BLOB_URL is the container
 * URL; credentials come from the environment through DefaultAzureCredential
 * (workload identity, managed identity, or a developer login), or from a
 * SAS token already present in the URL.
 */
import { ContainerClient } from '@azure/storage-blob';
import { assertKey, type BlobStore } from './blob.ts';
import type { Logger } from '../log.ts';

export async function azureBlobStore(containerUrl: string, log: Logger): Promise<BlobStore> {
  const hasSas = new URL(containerUrl).search.length > 1;
  let client: ContainerClient;
  if (hasSas) {
    client = new ContainerClient(containerUrl);
    log.info('blob.azure', { container: containerUrl.split('?')[0], credential: 'sas' });
  } else {
    const { DefaultAzureCredential } = await import('@azure/identity');
    client = new ContainerClient(containerUrl, new DefaultAzureCredential());
    log.info('blob.azure', { container: containerUrl, credential: 'default-azure-credential' });
  }
  return {
    driver: 'azure',
    put: async (key, data, contentType) => {
      assertKey(key);
      await client.getBlockBlobClient(key).uploadData(data, { blobHTTPHeaders: { blobContentType: contentType, blobCacheControl: 'public, max-age=31536000, immutable' } });
    },
    get: async (key) => {
      assertKey(key);
      const blob = client.getBlockBlobClient(key);
      if (!(await blob.exists())) return undefined;
      return new Uint8Array(await blob.downloadToBuffer());
    },
    delete: async (key) => {
      assertKey(key);
      await client.getBlockBlobClient(key).deleteIfExists();
    },
    list: async (prefix) => {
      const keys: string[] = [];
      for await (const item of client.listBlobsFlat({ prefix })) keys.push(item.name);
      return keys;
    },
    ping: async () => {
      await client.getProperties();
    },
  };
}
