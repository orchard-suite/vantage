export * from './target.ts';
export * from './publication.ts';
export { fsTarget } from './targets/fs.ts';
export { azureBlobTarget } from './targets/azure-blob.ts';
export { gitTarget } from './targets/git.ts';
export { webhookTarget, sharepointTarget, confluenceTarget, teamsTarget } from './targets/http.ts';
import { TargetRegistry } from './target.ts';
import { fsTarget } from './targets/fs.ts';
import { azureBlobTarget } from './targets/azure-blob.ts';
import { gitTarget } from './targets/git.ts';
import { webhookTarget, sharepointTarget, confluenceTarget, teamsTarget } from './targets/http.ts';

/** Every built-in target, ready to use. */
export function defaultTargets(): TargetRegistry {
  return new TargetRegistry().register(fsTarget).register(azureBlobTarget).register(gitTarget).register(webhookTarget).register(sharepointTarget).register(confluenceTarget).register(teamsTarget);
}
