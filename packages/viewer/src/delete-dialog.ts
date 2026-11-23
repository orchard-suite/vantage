/**
 * Delete, in the hub: says what goes with the diagram and that it cannot
 * come back, then deletes it and takes the reader to its workspace.
 */
import { HubError, type HubClient } from './hub.ts';
import { Dialog } from './dialog.ts';
import { h } from './dom.ts';

export class DeleteDialog {
  private readonly dialog: Dialog;
  private readonly error: HTMLElement;
  private readonly go: HTMLButtonElement;

  constructor(private readonly hub: HubClient, docTitle: string, private readonly next: string) {
    this.dialog = new Dialog(`Delete ${docTitle}?`, 'Its history, comments, guest links, and publications go with it. You cannot undo this.');
    this.error = h('p', 'v-revise-error');
    this.error.setAttribute('role', 'alert');
    this.error.hidden = true;
    this.dialog.body.appendChild(this.error);
    const keep = h('button', 'btn', 'Keep it');
    keep.type = 'button';
    keep.dataset['autofocus'] = '';
    keep.addEventListener('click', () => this.dialog.close());
    this.go = h('button', 'btn danger', 'Delete diagram');
    this.go.type = 'button';
    this.go.addEventListener('click', () => void this.remove());
    this.dialog.foot.append(keep, this.go);
  }

  open(): void {
    this.error.hidden = true;
    this.go.disabled = false;
    this.dialog.open();
  }

  private async remove(): Promise<void> {
    this.go.disabled = true;
    try {
      await this.hub.deleteDocument();
      location.href = this.next;
    } catch (err) {
      this.error.textContent = err instanceof HubError ? err.message : 'The hub did not answer. Try again.';
      this.error.hidden = false;
      this.go.disabled = false;
    }
  }
}
