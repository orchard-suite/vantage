/**
 * A registry the API modules describe their routes into, and the OpenAPI
 * document built from it. The registry lives beside the handlers, so the
 * published contract cannot drift from the code without an edit here.
 */
export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface RouteDoc {
  readonly method: Method;
  readonly path: string;
  readonly summary: string;
  readonly tag: string;
  readonly params?: readonly string[];
  readonly query?: readonly string[];
  readonly body?: Record<string, string>;
  readonly responses?: Record<string, string>;
  readonly auth?: 'viewer' | 'author' | 'admin' | 'user' | 'source' | 'pool' | 'none';
}

export class OpenApiRegistry {
  readonly routes: RouteDoc[] = [];
  add(route: RouteDoc): void {
    this.routes.push(route);
  }
  document(publicUrl: string, version: string): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = {};
    for (const r of this.routes) {
      const path = r.path.replace(/:([a-zA-Z]+)/g, '{$1}');
      paths[path] ??= {};
      paths[path][r.method] = {
        summary: r.summary,
        tags: [r.tag],
        'x-required-role': r.auth ?? 'user',
        parameters: [
          ...(r.params ?? []).map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
          ...(r.query ?? []).map((name) => ({ name, in: 'query', required: false, schema: { type: 'string' } })),
        ],
        ...(r.body
          ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: Object.fromEntries(Object.entries(r.body).map(([k, v]) => [k, { description: v }])) } } } } }
          : {}),
        responses: Object.fromEntries(Object.entries(r.responses ?? { '200': 'ok' }).map(([code, description]) => [code, { description }])),
        security: r.auth === 'none' ? [] : [{ bearer: [] }, { cookie: [] }],
      };
    }
    return {
      openapi: '3.1.0',
      info: { title: 'Vantage hub API', version },
      servers: [{ url: `${publicUrl}/api/v1` }],
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' }, cookie: { type: 'apiKey', in: 'cookie', name: 'vantage_session' } } },
      paths,
    };
  }
}
