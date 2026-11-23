/** Hub mode: Export and Share in the app bar, each opening its dialog, and Delete in the More menu when the workspace's rule allows it. */
import type { App } from './app.ts';
import type { BundleHub } from './bundle.ts';
import { HubClient } from './hub.ts';
import { iconButton } from './dom.ts';
import { ExportDialog } from './export-dialog.ts';
import { ShareDialog } from './share-dialog.ts';
import { DeleteDialog } from './delete-dialog.ts';

export function wireDocumentActions(app: App, hub: BundleHub, title: string): void {
  const client = new HubClient(hub);
  const current = (): App['context']['view'] => app.context.view;
  let exporter: ExportDialog | undefined;
  let sharer: ShareDialog | undefined;
  let deleter: DeleteDialog | undefined;
  const exportBtn = iconButton('export', 'Export: PNG, SVG, PDF, an interactive page, draw.io or Visio', () => {
    exporter ??= new ExportDialog(client, current, () => app.views, title);
    exporter.open();
  }, 'v-btn v-export-btn', 'Export');
  const shareBtn = iconButton('share', 'Share: guest links, embed, who has access', () => {
    sharer ??= new ShareDialog(client, current, () => app.views, title);
    void sharer.open();
  }, 'v-btn v-btn-primary v-share-btn', 'Share');
  app.bar.addAction(exportBtn, 'before-present');
  app.bar.addAction(shareBtn, 'after-present');
  if (hub.canDelete) {
    app.bar.addMenuItem('trash', 'Delete diagram', () => {
      deleter ??= new DeleteDialog(client, title, hub.workspaceUrl ?? '/');
      deleter.open();
    }, true);
  }
}
