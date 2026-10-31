import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Manager } from '../lib/manager.mjs';
import { Discovery, searchTerms } from '../lib/discovery.mjs';
import { gitHash } from '../lib/catalog.mjs';
import { createApp } from '../server.mjs';

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shelf-github-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const blobs = new Map(), calls = [];
  const files = [ ['SKILL.md', '---\nname: pdf-guide\ndescription: Read and organize PDF files\n---\n# Upstream skill\nDo not execute during discovery.'], ['README.md', '# Author introduction\nA PDF workflow for Codex.\n<script>bad()</script>'], ['LICENSE', 'Example license'] ].map(([name, content]) => {
    const buffer = Buffer.from(content), sha = gitHash(buffer); blobs.set(sha, buffer);
    return { path: name, sha, size: buffer.length, type: 'blob', mode: '100644' };
  });
  const repo = { full_name: 'author/pdf-skills', description: 'Author repository introduction', stargazers_count: 42, default_branch: 'main', pushed_at: '2026-10-30T01:00:00Z', license: { spdx_id: 'MIT' } };
  const fetcher = async (url, init) => {
    calls.push({ url, headers: init.headers }); const p = new URL(url).pathname;
    let value;
    if (p === '/search/code') {
      if (options.rejectCode) return { ok: false, status: 403, headers: new Headers() };
      value = { total_count: 1, incomplete_results: false, items: [{ path: 'SKILL.md', sha: files[0].sha, repository: { full_name: repo.full_name } }] };
    } else if (p === '/search/repositories') value = { total_count: 1, incomplete_results: false, items: [repo] };
    else if (p.includes('/commits/')) value = { sha: 'abc123' };
    else if (p.includes('/git/trees/')) value = { tree: files };
    else if (p.includes('/git/blobs/')) { const b = blobs.get(p.split('/').at(-1)); value = { encoding: 'base64', size: b.length, content: b.toString('base64') }; }
    else if (p === '/repos/author/pdf-skills') value = repo;
    else throw new Error(`Unexpected request ${p}`);
    return { ok: true, json: async () => value };
  };
  const m = await new Manager(root, { fetcher, githubToken: options.token || '', scanExternal: false }).init();
  return { root, m, d: new Discovery(m), calls, fetcher };
}
test('Chinese keyword expansion is disclosed and malformed searches fail', () => {
  assert.equal(searchTerms('请帮我找分镜技能'), 'storyboard'); assert.equal(searchTerms('PDF 文档'), 'document PDF');
  for (const q of ['', null, 'a'.repeat(141)]) assert.throws(() => searchTerms(q));
});
test('anonymous GitHub search identifies root skills, caches results and never installs', async t => {
  const f = await fixture(t), r = await f.d.search('pdf');
  assert.equal(r.mode, 'repository-discovery'); assert.equal(r.skills[0].name, 'pdf-guide');
  assert.equal(r.skills[0].source.path, ''); assert.equal(r.skills[0].repository.description, 'Author repository introduction');
  assert.match(r.scope, /不是全站完整索引/); const count = f.calls.length;
  await f.d.search('pdf'); assert.equal(f.calls.length, count);
  assert.deepEqual(f.m.state.installs, {}); assert.equal(f.m.catalog.length, 0);
  await assert.rejects(f.d.search('pdf', -1), /页码/);
});
test('authenticated code search uses server-only credentials and falls back on permission errors', async t => {
  const f = await fixture(t, { token: 'test-only-token' }), r = await f.d.search('pdf');
  assert.equal(r.mode, 'authenticated-code-search'); assert.equal(r.skills.length, 1);
  assert.equal(f.calls[0].headers.Authorization, 'Bearer test-only-token'); assert.ok(!JSON.stringify(r).includes('test-only-token'));
  assert.ok(f.calls.every(c => new URL(c.url).hostname === 'api.github.com'));
  const g = await fixture(t, { token: 'test-only-token', rejectCode: true }); const fallback = await g.d.search('pdf');
  assert.equal(fallback.mode, 'repository-discovery'); assert.match(fallback.warnings[0], /精确代码搜索不可用/);
});
test('author detail retrieves README as data; root skill can be collected independently of install', async t => {
  const f = await fixture(t), url = 'https://github.com/author/pdf-skills/tree/main';
  const r = await f.d.detail(url); assert.equal(r.repository.stars, 42); assert.equal(r.introductions.length, 1);
  assert.match(r.introductions[0].content, /<script>bad/); assert.equal(r.imported, false);
  const collected = await f.m.importSource(url); assert.equal(collected.source.path, '');
  assert.equal(f.m.catalog.length, 1); assert.deepEqual(f.m.state.installs, {});
  assert.equal((await f.d.detail(url)).imported, true);
  const preview = await f.m.preview(collected.id); await f.m.install(preview.token);
  assert.ok(await fs.readFile(path.join(f.m.target, 'pdf-skills', 'SKILL.md'), 'utf8'));
  await assert.rejects(f.d.detail('https://evil.example/author/pdf-skills/tree/main'));
});
test('Codex CLI entry performs live search and detail through authenticated loopback API', async t => {
  const f = await fixture(t), { server } = await createApp(f.root, { fetcher: f.fetcher, githubToken: '', scanExternal: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const env = { ...process.env, SKILL_SHELF_PORT: String(server.address().port) };
  const script = path.resolve(import.meta.dirname, '../plugin/skills/skill-shelf/scripts/shelf.mjs');
  const exec = promisify(execFile);
  const search = JSON.parse((await exec(process.execPath, [script, 'search', 'pdf'], { env, cwd: f.root })).stdout);
  assert.equal(search.skills[0].name, 'pdf-guide');
  const detail = JSON.parse((await exec(process.execPath, [script, 'detail', search.skills[0].sourceUrl], { env, cwd: f.root })).stdout);
  assert.equal(detail.repository.description, 'Author repository introduction');
  const collected = JSON.parse((await exec(process.execPath, [script, 'collect', search.skills[0].sourceUrl], { env, cwd: f.root })).stdout);
  assert.equal(collected.name, 'pdf-guide');
});
