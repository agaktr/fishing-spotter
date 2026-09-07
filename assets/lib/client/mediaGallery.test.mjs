import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

const compiled = ts.transpileModule(await readFile(new URL('../../components/TripMediaGallery.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function harness() {
  const effects = [], updates = [], requests = [], created = [], revoked = [];
  const events = new EventTarget();
  let resolve;
  const context = { exports: {}, window: events, URL: { createObjectURL: () => { created.push('blob:fixture'); return 'blob:fixture'; }, revokeObjectURL: url => revoked.push(url) }, require: id => {
    if (id === 'react/jsx-runtime') return jsx;
    if (id === 'react-dom') return { createPortal: value => value };
    if (id === 'react') return { useState: () => [undefined, value => updates.push(value)], useRef: () => ({ current: null }), useEffect: effect => effects.push(effect) };
    if (id === '@/lib/client/api') return { SESSION_ENDED_EVENT: 'ended', fetchTripImage: url => { requests.push(url); return new Promise(done => { resolve = done; }); } };
    throw new Error(id);
  } };
  vm.runInNewContext(compiled, context);
  const image = { id: 'one', originalName: 'one.jpg', url: '/api/media/one', thumbnailUrl: '/api/media/one/thumb' };
  const gallery = context.exports.TripMediaGallery({ images: [image] });
  const thumbnail = gallery.props.children[0].props.children[0].props.children[0].props.children;
  effects.length = 0;
  thumbnail.type({ image, full: true });
  const cleanup = effects[0]();
  return { updates, requests, created, revoked, cleanup, end: () => events.dispatchEvent(new Event('ended')), finish: async () => { resolve(new Blob(['fixture'])); await new Promise(done => setImmediate(done)); } };
}

test('viewer fetches full media through authorized helper and revokes its blob on unmount', async () => {
  const h = harness();
  assert.deepEqual(h.requests, ['/api/media/one']);
  await h.finish();
  assert.deepEqual(h.created, ['blob:fixture']);
  h.cleanup();
  assert.deepEqual(h.revoked, ['blob:fixture']);
});

test('late media completion after close or session end never creates a blob', async () => {
  for (const action of ['cleanup', 'end']) {
    const h = harness();
    h[action]();
    await h.finish();
    assert.deepEqual(h.created, []);
    h.cleanup();
  }
});

test('session end clears displayed media and revokes only once', async () => {
  const h = harness();
  await h.finish();
  h.end();
  assert.equal(h.updates.at(-1), undefined);
  h.cleanup();
  assert.deepEqual(h.revoked, ['blob:fixture']);
});
