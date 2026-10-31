import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Manager, safePath } from '../lib/manager.mjs';
import { gitHash, metadata, parseSource } from '../lib/catalog.mjs';
import { createApp } from '../server.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-shelf-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  let version = 1, corrupt = false, malicious = false;
  const skill = { source: { repo: 'example/skills', path: 'skills/demo', ref: 'main' } };
  const blobs = new Map();
  const entries = () => ['SKILL.md', 'scripts/example.js'].map(name => {
    const content = name === 'SKILL.md' ? `---\nname: demo\ndescription: A useful test skill\n---\nVersion ${version}` : `throw new Error('must never execute'); // ${version}`;
    const b = Buffer.from(content), sha = gitHash(b); blobs.set(sha, b);
    return { path: `skills/demo/${name}`, sha, size: b.length, type: 'blob', mode: '100644' };
  });
  const fetcher = async url => {
    const pathname = new URL(url).pathname;
    let result;
    if (pathname.includes('/commits/')) result = { sha: `commit-${version}` };
    else if (pathname.includes('/git/trees/')) result = { tree: [...entries(), ...(malicious ? [{ path: 'skills/demo/../escape', sha: 'bad', size: 1, type: 'blob', mode: '100644' }] : [])] };
    else { const b = blobs.get(pathname.split('/').at(-1)); result = { size: b.length, encoding: 'base64', content: (corrupt ? Buffer.from('corrupt') : b).toString('base64') }; }
    return { ok: true, json: async () => result };
  };
  const m = await new Manager(root, { fetcher, scanExternal: false }).init(); m.catalog = [m.item(skill.source, 'demo', 'commit-1')];
  return { root, m, fetcher, id: m.catalog[0].id, next: () => version++, corrupt: () => corrupt = true, malicious: () => malicious = true };
}
test('source and destination validation reject unsafe paths', () => {
  for (const value of ['../escape', 'C:/escape', 'a\\b', 'x/../../escape', 'aux.txt', 'x.']) assert.throws(() => safePath(os.tmpdir(), value));
  for (const value of ['http://github.com/a/b/tree/main/x', 'https://evil.com/a/b/tree/main/x', 'https://github.com/a/b/tree/main/x%5Cbad']) assert.throws(() => parseSource(value));
  assert.equal(parseSource('https://github.com/a/b/tree/main/skills/demo').path, 'skills/demo');
  assert.equal(metadata('---\nname: demo\ndescription: >\n  Line one\n  line two\nmetadata:\n  anything: value\n---\n').description, 'Line one   line two');
});
test('pinned install, persistent state, update, rollback and archived uninstall', async t => {
  const f = await fixture(t), p = await f.m.preview(f.id); f.next();
  await f.m.install(p.token); assert.equal(f.m.state.installs[f.id].commit, 'commit-1');
  assert.match(await fs.readFile(path.join(f.m.target, 'demo', 'SKILL.md'), 'utf8'), /Version 1/);
  const p2 = await f.m.preview(f.id); await f.m.install(p2.token);
  assert.match(await fs.readFile(path.join(f.m.target, 'demo', 'SKILL.md'), 'utf8'), /Version 2/);
  await f.m.rollback(f.id); assert.match(await fs.readFile(path.join(f.m.target, 'demo', 'SKILL.md'), 'utf8'), /Version 1/);
  const reloaded = await new Manager(f.root, { fetcher: f.fetcher, scanExternal: false }).init(); assert.equal(reloaded.state.installs[f.id].commit, 'commit-1');
  await reloaded.uninstall(f.id); await assert.rejects(fs.access(path.join(f.m.target, 'demo')));
  assert.ok((await fs.readdir(path.join(f.m.data, 'backups'))).length);
});
test('local edits stop update, rollback and uninstall without losing files', async t => {
  const f = await fixture(t); await f.m.install((await f.m.preview(f.id)).token); f.next(); await f.m.install((await f.m.preview(f.id)).token);
  const file = path.join(f.m.target, 'demo', 'SKILL.md'); await fs.appendFile(file, '\nUSER EDIT');
  await assert.rejects(f.m.install((await f.m.preview(f.id)).token), /本地修改/);
  await assert.rejects(f.m.rollback(f.id), /本地修改/); await assert.rejects(f.m.uninstall(f.id), /本地修改/);
  assert.match(await fs.readFile(file, 'utf8'), /USER EDIT/);
});
test('corrupt download, unsafe tree, external collision and expired preview fail safely', async t => {
  const f = await fixture(t), p = await f.m.preview(f.id); f.corrupt();
  await assert.rejects(f.m.install(p.token), /完整性/); await assert.rejects(fs.access(path.join(f.m.target, 'demo')));
  const g = await fixture(t); g.malicious(); await assert.rejects(g.m.preview(g.id), /路径/);
  const h = await fixture(t), hp = await h.m.preview(h.id); await h.m.ensureTarget(); await fs.mkdir(path.join(h.m.target, 'demo'));
  await assert.rejects(h.m.install(hp.token), /同名/); h.m.plans.get(hp.token).expires = 0; await assert.rejects(h.m.install(hp.token), /过期/);
});
test('HTTP API blocks cross-origin and unauthenticated requests', async t => {
  const f = await fixture(t), { server } = await createApp(f.root, { fetcher: f.fetcher, scanExternal: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/overview')).status, 403);
  const token = (await (await fetch(base + '/api/session')).json()).token;
  assert.equal((await fetch(base + '/api/overview', { headers: { 'X-Shelf-Token': token } })).status, 200);
  assert.equal((await fetch(base + '/api/sync', { method: 'POST', headers: { Origin: 'https://evil.example', 'X-Shelf-Token': token, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});
test('GitHub import persists metadata, deduplicates and remains uninstalled', async t => {
  const f = await fixture(t), url = 'https://github.com/example/skills/tree/main/skills/demo';
  const result = await f.m.importSource(url); assert.equal(result.name, 'demo');
  await f.m.importSource(url); assert.equal(f.m.catalog.length, 1);
  const loaded = await new Manager(f.root, { fetcher: f.fetcher, scanExternal: false }).init();
  assert.equal(loaded.catalog[0].description, 'A useful test skill');
  assert.equal(loaded.catalog[0].summary, 'A useful test skill');
  assert.deepEqual(loaded.state.installs, {});
});
test('plugin package has valid metadata and resolvable local marketplace paths', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'plugin', 'plugin.json'), 'utf8'));
  const marketplace = JSON.parse(await fs.readFile(path.join(root, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
  assert.equal(manifest.name, marketplace.plugins[0].name);
  await fs.access(path.join(root, marketplace.plugins[0].source.path, 'plugin.json'));
  const skill = metadata(await fs.readFile(path.join(root, 'plugin', 'skills', 'skill-shelf', 'SKILL.md'), 'utf8'));
  assert.match(skill.name, /^[a-z0-9-]{1,64}$/); assert.ok(skill.description.length > 30);
  await fs.access(path.join(root, 'plugin', 'skills', 'skill-shelf', 'scripts', 'shelf.mjs'));
});
