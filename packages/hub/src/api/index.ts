/** The REST API under /api/v1, with its OpenAPI document and the routes the API page reads. */
import { Hono } from 'hono';
import type { AppContext } from '../context.ts';
import type { HubEnv } from '../web/env.ts';
import { OpenApiRegistry, type RouteDoc } from './openapi.ts';
import { workspaceRoutes } from './workspaces.ts';
import { documentRoutes } from './documents.ts';
import { collabRoutes } from './collab.ts';
import { viewerRoutes } from './viewer.ts';
import { tokenRoutes } from './tokens.ts';
import { adminRoutes } from './admin.ts';
import { sourceRoutes } from './sources.ts';
import { mappingRoutes } from './mappings.ts';
import { pushRoutes } from './push.ts';
import { poolRoutes } from './pool.ts';
import { publicationRoutes } from './publications.ts';
import { driftRoutes } from './drift.ts';
import { secretRoutes } from './secrets.ts';
import { transferRoutes } from './transfer.ts';
import { iconRoutes } from './icons.ts';
import { shareRoutes } from './share.ts';
import { previewRoutes } from './preview.ts';
import { textRoutes } from './text.ts';
import { scopeRoutes } from './scopes.ts';
import { libraryRoutes } from './library.ts';
import { reviseRoutes } from './revise.ts';
import { editorRoutes } from './editor.ts';
import { generateRoutes } from './generate.ts';
import { recordingRoutes } from './recordings.ts';
import { reviewRoutes } from './review.ts';
import { decisionRoutes } from './decisions.ts';
import { itemRoutes } from './items.ts';

export const API_VERSION = '2.5.0';

export interface Api {
  readonly app: Hono<HubEnv>;
  readonly routes: readonly RouteDoc[];
}

export function apiRoutes(ctx: AppContext): Api {
  const app = new Hono<HubEnv>();
  const reg = new OpenApiRegistry();
  reg.add({ method: 'get', path: '/openapi.json', summary: 'This document', tag: 'meta', auth: 'none' });
  app.route('/', workspaceRoutes(ctx, reg));
  app.route('/', documentRoutes(ctx, reg));
  app.route('/', collabRoutes(ctx, reg));
  app.route('/', viewerRoutes(ctx, reg));
  app.route('/', tokenRoutes(ctx, reg));
  app.route('/', adminRoutes(ctx, reg));
  app.route('/', sourceRoutes(ctx, reg));
  app.route('/', mappingRoutes(ctx, reg));
  app.route('/', pushRoutes(ctx, reg));
  app.route('/', poolRoutes(ctx, reg));
  app.route('/', publicationRoutes(ctx, reg));
  app.route('/', driftRoutes(ctx, reg));
  app.route('/', secretRoutes(ctx, reg));
  app.route('/', transferRoutes(ctx, reg));
  app.route('/', iconRoutes(ctx, reg));
  app.route('/', shareRoutes(ctx, reg));
  app.route('/', previewRoutes(ctx, reg));
  app.route('/', libraryRoutes(ctx, reg));
  app.route('/', reviseRoutes(ctx, reg));
  app.route('/', editorRoutes(ctx, reg));
  app.route('/', generateRoutes(ctx, reg));
  app.route('/', recordingRoutes(ctx, reg));
  app.route('/', reviewRoutes(ctx, reg));
  app.route('/', decisionRoutes(ctx, reg));
  app.route('/', textRoutes(ctx, reg));
  app.route('/', scopeRoutes(ctx, reg));
  app.route('/', itemRoutes(ctx, reg));
  const doc = reg.document(ctx.config.PUBLIC_URL, API_VERSION);
  ctx.log.info('api.routes', { count: reg.routes.length });
  app.get('/openapi.json', (c) => c.json(doc));
  return { app, routes: reg.routes };
}
