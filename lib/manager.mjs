import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { classify, metadata, gitHash, fingerprint, officialSource, parseSource } from './catalog.mjs';

const exists = async p => { try { await fs.lstat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
export function safePath(base, relative) {
  if (!relative || relative.split('/').some(p => !p || p === '.' || p === '..' || /[\\:\x00-\x1f<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('不安全的文件路径。');
  const result = path.resolve(base, relative);
  if (!result.startsWith(path.resolve(base) + path.sep)) throw new Error('文件路径越界。');
  return result;
}
export class Manager {
  constructor(root, options = {}) {
    this.root = path.resolve(root); this.data = path.join(this.root, 'data');
    this.target = path.join(this.root, '.agents', 'skills');
    this.fetcher = options.fetcher || fetch; this.scanExternal = options.scanExternal !== false;
    this.githubToken = options.githubToken ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
    this.authenticated = Boolean(this.githubToken);
    this.plans = new Map(); this.busy = false;
  }
  async init() {
    await fs.mkdir(this.data, { recursive: true });
    this.state = await this.read('state.json', { favorites: [], installs: {}, sources: [], lastSync: null });
    this.catalog = await this.read('catalog.json', []);
    if (!this.catalog.length) { try { this.catalog = JSON.parse(await fs.readFile(path.join(this.root, 'catalog.snapshot.json'), 'utf8')); } catch {} }
    return this;
  }
  async read(name, fallback) { try { return JSON.parse(await fs.readFile(path.join(this.data, name), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
  async write(name, value) { const p = path.join(this.data, name), tmp = `${p}.${randomUUID()}.tmp`; await fs.writeFile(tmp, JSON.stringify(value, null, 2)); await fs.rename(tmp, p); }
  async exclusive(fn) { if (this.busy) throw new Error('另一项操作正在进行，请稍后重试。'); this.busy = true; try { return await fn(); } finally { this.busy = false; } }
  async github(endpoint) {
    if (!endpoint.startsWith('/') || endpoint.startsWith('//')) throw new Error('无效 GitHub API 路径。');
    const response = await this.fetcher(`https://api.github.com${endpoint}`, { headers: { 'User-Agent': 'SkillShelf/0.2', 'Accept': 'application/vnd.github+json', ...(this.githubToken ? { Authorization: `Bearer ${this.githubToken}` } : {}) }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) { const reset = response.headers?.get('x-ratelimit-reset'); throw new Error(response.status === 401 ? 'GitHub 认证无效，请检查服务端 Token。' : response.status === 403 || response.status === 429 ? `GitHub 请求受到限制或权限不足。${reset ? `配额重置时间：${new Date(Number(reset) * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}` : '请稍后重试。'}` : `GitHub 请求失败（${response.status}）。`); }
    return response.json();
  }
  async resolve(source) { const commit = await this.github(`/repos/${source.repo}/commits/${encodeURIComponent(source.ref)}`); return commit.sha; }
  async tree(source, commit) {
    const tree = await this.github(`/repos/${source.repo}/git/trees/${commit}?recursive=1`);
    if (tree.truncated) throw new Error('仓库目录过大，请选择更小的仓库。');
    return tree.tree;
  }
  item(source, name, commit, description = '') {
    return { id: `${source.repo}:${source.path}`, name, ...classify(name, description), source, commit, sourceUrl: `https://github.com/${source.repo}/tree/${commit}/${source.path}`, official: source.repo === 'openai/skills', validation: '待运行验证', checkedAt: new Date().toISOString() };
  }
  async sync() { return this.exclusive(async () => {
    const commit = await this.resolve(officialSource), tree = await this.tree(officialSource, commit);
    const prefix = officialSource.path + '/';
    const official = tree.filter(f => f.type === 'blob' && f.path.startsWith(prefix) && f.path.slice(prefix.length).split('/').length === 2 && f.path.endsWith('/SKILL.md')).map(f => {
      const name = f.path.slice(prefix.length).split('/')[0]; return this.item({ ...officialSource, path: prefix + name }, name, commit);
    });
    if (!official.length) throw new Error('上游没有返回可识别的技能，保留原目录。');
    const metadataWarnings = [];
    for (let i = 0; i < official.length; i += 5) await Promise.all(official.slice(i, i + 5).map(async item => {
      try {
        const file = tree.find(f => f.path === `${item.source.path}/SKILL.md`);
        const bytes = await this.blob(item.source.repo, file.sha, 1024 * 1024);
        const meta = metadata(bytes.toString('utf8'));
        item.description = meta.description;
        item.structureChecked = Boolean(meta.name && meta.description);
      } catch { metadataWarnings.push(item.name); item.structureChecked = false; }
    }));
    const order = ['pdf', 'playwright', 'figma', 'jupyter-notebook', 'notion-research-documentation', 'gh-fix-ci', 'speech', 'transcribe', 'openai-docs'];
    official.sort((a, b) => { const ai = order.indexOf(a.name), bi = order.indexOf(b.name); return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi); });
    const imported = this.catalog.filter(s => !s.official);
    const next = [...official, ...imported]; await this.write('catalog.json', next); this.catalog = next;
    this.state.lastSync = new Date().toISOString(); await this.write('state.json', this.state);
    return { count: official.length, commit, metadataWarnings };
  }); }
  async importSource(url) { return this.exclusive(async () => {
    const source = parseSource(url), commit = await this.resolve(source), tree = await this.tree(source, commit);
    const entry = tree.find(f => f.path === `${source.path ? source.path + '/' : ''}SKILL.md` && f.type === 'blob' && f.mode !== '120000');
    if (!entry) throw new Error('这个目录没有 SKILL.md。请选择单个技能的目录。');
    const blob = await this.blob(source.repo, entry.sha, 1024 * 1024), meta = metadata(blob.toString('utf8'));
    if (!meta.name || !meta.description) throw new Error('SKILL.md 缺少 name 或 description。');
    const item = this.item(source, meta.name, commit, meta.description);
    item.description = meta.description; item.structureChecked = true;
    this.catalog = [...this.catalog.filter(s => s.id !== item.id), item]; await this.write('catalog.json', this.catalog); return item;
  }); }
  async blob(repo, sha, limit = 5 * 1024 * 1024) {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('无效的文件版本。');
    const cache = path.join(this.data, 'blobs', sha);
    try { const bytes = await fs.readFile(cache); if (bytes.length <= limit && gitHash(bytes) === sha) return bytes; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const b = await this.github(`/repos/${repo}/git/blobs/${sha}`);
    if (b.encoding !== 'base64' || b.size > limit) throw new Error('文件超出大小限制或编码不支持。');
    const bytes = Buffer.from(b.content, 'base64');
    if (bytes.length > limit || gitHash(bytes) !== sha) throw new Error('文件完整性校验失败。');
    await fs.mkdir(path.dirname(cache), { recursive: true }); await fs.writeFile(cache, bytes);
    return bytes;
  }
  find(id) { const s = this.catalog.find(s => s.id === id); if (!s) throw new Error('未找到这个技能。'); return s; }
  async preview(id) {
    const skill = this.find(id), commit = await this.resolve(skill.source), tree = await this.tree(skill.source, commit);
    const prefix = skill.source.path ? skill.source.path + '/' : '';
    const entries = tree.filter(f => f.path.startsWith(prefix));
    if (entries.some(f => !['blob', 'tree'].includes(f.type) || f.mode === '120000')) throw new Error('技能包含符号链接或子模块，当前版本不支持安装。');
    const files = entries.filter(f => f.type === 'blob').map(f => ({ path: f.path.slice(prefix.length), sha: f.sha, size: f.size || 0 }));
    files.forEach(f => safePath(this.target, f.path));
    if (!files.length || files.length > 180 || files.reduce((n, f) => n + f.size, 0) > 16 * 1024 * 1024 || files.some(f => f.size > 5 * 1024 * 1024)) throw new Error('技能超出首版限制：最多 180 个文件、总计 16 MB、单文件 5 MB。');
    const entry = files.find(f => f.path === 'SKILL.md'); if (!entry) throw new Error('技能缺少 SKILL.md。');
    const content = (await this.blob(skill.source.repo, entry.sha)).toString('utf8'), meta = metadata(content);
    if (!meta.name || !meta.description) throw new Error('SKILL.md 缺少必要的名称或描述。');
    const license = tree.filter(f => f.type === 'blob' && /(^|\/)(licen[sc]e|copying)(\.[^/]*)?$/i.test(f.path) && (f.path.startsWith(prefix) || !f.path.includes('/'))).map(f => ({ path: f.path, url: `https://github.com/${skill.source.repo}/blob/${commit}/${f.path}` }));
    const report = { id, token: randomUUID(), commit, files, content, meta, license, fingerprint: fingerprint(files), expires: Date.now() + 15 * 60 * 1000, executableFiles: files.filter(f => /\.(py|sh|ps1|js|mjs|cmd|bat|exe)$/i.test(f.path)).map(f => f.path), target: path.join(this.target, this.slug(skill)), existing: this.state.installs[id] || null };
    for (const [k, v] of this.plans) if (v.expires < Date.now()) this.plans.delete(k);
    if (this.plans.size >= 100) this.plans.delete(this.plans.keys().next().value);
    this.plans.set(report.token, { ...report, skill }); return report;
  }
  slug(s) { const name = s.source.path ? s.source.path.split('/').at(-1) : s.source.repo.split('/').at(-1); safePath(this.target, name); return name; }
  async ensureTarget() {
    // Refuse symlinked managed roots; never write through a user-created link.
    let p = this.root;
    for (const part of ['.agents', 'skills']) { p = path.join(p, part); if (await exists(p)) { if ((await fs.lstat(p)).isSymbolicLink()) throw new Error('安装目录不能是符号链接。'); } else await fs.mkdir(p); }
  }
  async hashes(directory) {
    const files = [];
    const walk = async (dir, prefix = '') => { for (const e of await fs.readdir(dir, { withFileTypes: true })) { const rel = prefix + e.name; if (e.isSymbolicLink()) throw new Error('发现符号链接，停止修改。'); if (e.isDirectory()) await walk(path.join(dir, e.name), rel + '/'); else files.push({ path: rel, sha: gitHash(await fs.readFile(path.join(dir, e.name))) }); } };
    await walk(directory); return fingerprint(files);
  }
  async clean(record) {
    await this.ensureTarget(); const dest = safePath(this.target, record.slug);
    if (!(await exists(dest))) throw new Error('已安装目录不存在。');
    if (await this.hashes(dest) !== record.fingerprint) throw new Error('检测到本地修改。请先备份或恢复文件，管理器不会覆盖这些修改。');
    return dest;
  }
  async install(token) { return this.exclusive(async () => {
    const plan = this.plans.get(token);
    if (!plan || plan.expires < Date.now()) throw new Error('预览已过期，请重新查看详情。');
    await this.ensureTarget(); const slug = this.slug(plan.skill), dest = safePath(this.target, slug);
    const old = this.state.installs[plan.id];
    if (old) await this.clean(old); else if (await exists(dest)) throw new Error('同名技能已存在，管理器不会覆盖外部技能。');
    const stage = path.join(this.data, 'staging', randomUUID()); await fs.mkdir(stage, { recursive: true });
    try {
      for (const f of plan.files) { const out = safePath(stage, f.path); await fs.mkdir(path.dirname(out), { recursive: true }); await fs.writeFile(out, await this.blob(plan.skill.source.repo, f.sha)); }
      if (await this.hashes(stage) !== plan.fingerprint) throw new Error('下载目录完整性校验失败。');
      const archive = path.join(this.data, 'backups', randomUUID()); await fs.mkdir(path.dirname(archive), { recursive: true });
      if (old) await fs.rename(dest, archive);
      try { await fs.rename(stage, dest); } catch (e) { if (old) await fs.rename(archive, dest); throw e; }
      const record = { slug, commit: plan.commit, fingerprint: plan.fingerprint, installedAt: new Date().toISOString(), source: plan.skill.source, name: plan.meta.name, backup: old ? { directory: archive, record: old } : null };
      this.state.installs[plan.id] = record;
      try { await this.write('state.json', this.state); } catch (e) { await fs.rename(dest, stage); if (old) { await fs.rename(archive, dest); this.state.installs[plan.id] = old; } else delete this.state.installs[plan.id]; throw e; }
      this.plans.delete(token); return { record, message: '安装完成。请在 Codex 下一轮或新会话中检查技能是否可见；这里未执行技能内容。' };
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  }); }
  async uninstall(id) { return this.exclusive(async () => {
    const record = this.state.installs[id]; if (!record) throw new Error('仅支持卸载由本管理器安装的技能。');
    const dest = await this.clean(record), archive = path.join(this.data, 'backups', randomUUID()); await fs.mkdir(path.dirname(archive), { recursive: true });
    await fs.rename(dest, archive); delete this.state.installs[id];
    try { await this.write('state.json', this.state); } catch (e) { await fs.rename(archive, dest); this.state.installs[id] = record; throw e; }
    return { message: '已卸载，文件已归档保留。' };
  }); }
  async rollback(id) { return this.exclusive(async () => {
    const record = this.state.installs[id]; if (!record?.backup) throw new Error('这个技能没有可回退版本。');
    const dest = await this.clean(record), backup = record.backup;
    if (!backup.directory.startsWith(path.join(this.data, 'backups') + path.sep) || await this.hashes(backup.directory) !== backup.record.fingerprint) throw new Error('备份完整性校验失败。');
    const archive = path.join(this.data, 'backups', randomUUID()); await fs.rename(dest, archive);
    try { await fs.rename(backup.directory, dest); } catch (e) { await fs.rename(archive, dest); throw e; }
    this.state.installs[id] = { ...backup.record, backup: null };
    try { await this.write('state.json', this.state); } catch (e) { await fs.rename(dest, backup.directory); await fs.rename(archive, dest); this.state.installs[id] = record; throw e; }
    return { message: '已回退到上一个安装版本。' };
  }); }
  async favorite(id) { return this.exclusive(async () => { this.find(id); const set = new Set(this.state.favorites); set.has(id) ? set.delete(id) : set.add(id); this.state.favorites = [...set]; await this.write('state.json', this.state); return this.state.favorites; }); }
  async local() {
    const found = [], warnings = [], roots = [{ directory: this.target, scope: '项目技能', depth: 1 }];
    if (this.scanExternal) roots.push({ directory: path.join(os.homedir(), '.agents', 'skills'), scope: '个人技能', depth: 2 }, { directory: path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills'), scope: 'Codex 技能', depth: 2 }, { directory: path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'plugins', 'cache'), scope: '插件资源（不代表已启用）', depth: 7 });
    const walk = async (dir, scope, depth) => {
      let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code !== 'ENOENT') warnings.push(`${dir}: ${e.code}`); return; }
      if (entries.some(e => e.name === 'SKILL.md' && e.isFile())) {
        try { const meta = metadata(await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8')); const managed = Object.entries(this.state.installs).find(([, v]) => path.join(this.target, v.slug) === dir); found.push({ id: managed?.[0] || `local:${dir}`, name: meta.name || path.basename(dir), description: meta.description, ...classify(meta.name || path.basename(dir), meta.description), directory: dir, scope, managed: Boolean(managed), record: managed?.[1] }); } catch (e) { warnings.push(`${dir}: ${e.code || e.message}`); }
        return;
      }
      if (depth <= 0 || found.length >= 1500) return;
      for (const e of entries) if (e.isDirectory() && !['node_modules', '.git', 'data', 'assets', 'references', 'scripts'].includes(e.name)) await walk(path.join(dir, e.name), scope, depth - 1);
    };
    for (const r of roots) await walk(r.directory, r.scope, r.depth);
    return { items: found, warnings };
  }
  async overview() { return { catalog: this.catalog, favorites: this.state.favorites, installs: this.state.installs, lastSync: this.state.lastSync, target: this.target, local: await this.local() }; }
}
