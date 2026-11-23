/**
 * The workspace's own icon pack, as one tool. The hub's door takes the
 * picture's bytes; a laptop's door takes its path and sends the bytes
 * itself, so a picture never passes through the model (VAN-5003).
 */
import { z } from 'zod';

const ICON_FORMATS = ['svg', 'png', 'jpg', 'gif', 'webp'] as const;
export type IconFormat = (typeof ICON_FORMATS)[number];

const common = {
  workspace: z.string().describe('Workspace slug'),
  action: z.enum(['list', 'put', 'delete']),
  id: z.string().optional().describe('Icon id, pack/name; for put and delete'),
  format: z.enum(ICON_FORMATS).optional().describe("Picture format; for put, default svg, or the file's own"),
};

/** The format a picture file names by its extension, if it is one an icon may be. */
export function iconFormatOf(path: string): IconFormat | undefined {
  const ext = path.toLowerCase().split('.').pop();
  const f = ext === 'jpeg' ? 'jpg' : ext;
  return ICON_FORMATS.find((x) => x === f);
}

export const WORKSPACE_ICONS = {
  name: 'vantage_workspace_icons',
  description: "The workspace's own icon pack: logos and marks every document in the workspace names as pack/name (acme/logo). List them, put one (documents re-render), or delete one. Shipped pack names (generic, azure, aws, k8s, brand) are taken.",
  shape: { ...common, data: z.string().optional().describe('The picture in base64; for put') },
  laptopShape: { ...common, file: z.string().optional().describe('Absolute path of the picture on this machine; for put') },
};
