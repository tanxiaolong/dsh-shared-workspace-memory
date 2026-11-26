import assert from 'node:assert/strict';
import { test } from 'node:test';

import { admissionRejection, connectionOf } from '../lib/admission.js';

/** A ctx whose service lookup answers with the given value (or throws). */
function fakeCtx(connection) {
  return {
    get(name) {
      assert.equal(name, 'connection');
      if (connection instanceof Error) throw connection;
      return connection;
    },
  };
}

test('no Connection service: the route falls back to its own guards', () => {
  assert.equal(connectionOf({ get: () => undefined }), undefined);
  assert.equal(admissionRejection({ get: () => undefined }, { headers: {} }), undefined);
  assert.equal(connectionOf(undefined), undefined);
  assert.equal(connectionOf({}), undefined);
});

test('an unusable lookup (throwing ctx.get) is treated as no service', () => {
  const ctx = fakeCtx(new Error('cannot get property "connection" without inject'));
  assert.equal(connectionOf(ctx), undefined);
  assert.equal(admissionRejection(ctx, { headers: {} }), undefined);
});

test('an admitted request passes through', () => {
  const ctx = fakeCtx({ requestRejection: () => undefined });
  assert.equal(admissionRejection(ctx, { headers: { host: '127.0.0.1:8080' } }), undefined);
});

test('DSH rejection statuses are returned verbatim', () => {
  for (const status of [401, 403]) {
    const ctx = fakeCtx({ requestRejection: () => status });
    assert.equal(admissionRejection(ctx, { headers: {} }), status);
  }
});

test('the request is handed to DSH untouched', () => {
  const seen = [];
  const request = { headers: { host: '127.0.0.1:8080', cookie: 'dsh-auth-x' }, url: '/api/x' };
  const ctx = fakeCtx({ requestRejection: (value) => { seen.push(value); return undefined; } });
  admissionRejection(ctx, request);
  assert.deepEqual(seen, [request]);
});

test('a throwing fence fails closed', () => {
  const ctx = fakeCtx({ requestRejection: () => { throw new Error('boom'); } });
  assert.equal(admissionRejection(ctx, { headers: {} }), 401);
});

test('a non-numeric rejection is ignored rather than turned into a status', () => {
  const ctx = fakeCtx({ requestRejection: () => 'nope' });
  assert.equal(admissionRejection(ctx, { headers: {} }), undefined);
});

test('a service without requestRejection is not a fence', () => {
  const ctx = fakeCtx({ someOtherMethod: () => 401 });
  assert.equal(admissionRejection(ctx, { headers: {} }), undefined);
});

test('the shipped bridge wires the fence before it touches the disk', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('const routes = ['), source.indexOf('const registered = new Set()'));
  const admissionAt = handler.indexOf('admissionRejection(ctx, request)');
  assert.ok(admissionAt >= 0, 'the bridge handler must ask DSH for admission');
  for (const call of ['await status()', 'await run(']) {
    const callAt = handler.indexOf(call);
    if (callAt < 0) continue;
    assert.ok(admissionAt < callAt, `admission must precede ${call}`);
  }
  assert.match(source, /const VERSION = '0\.2\.3'/u);
});
