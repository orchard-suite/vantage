/** Wraps every test in a database scope (test-scope.ts); `bunfig.toml` preloads it, so only the test runner loads it. */
import { afterEach, beforeEach } from 'bun:test';
import { closeScope, openScope } from './test-scope.ts';

beforeEach(openScope);
afterEach(closeScope);
