import { metadata, classify, parseSource } from './catalog.mjs';

const translations = [['分镜', 'storyboard'], ['剧本', 'screenplay'], ['导演', 'director'], ['影视', 'film'], ['视频', 'video'], ['音频', 'audio'], ['配音', 'speech'], ['图片', 'image'], ['绘图', 'image'], ['设计', 'design'], ['表格', 'spreadsheet'], ['数据分析', 'data analysis'], ['文档', 'document'], ['演示', 'slides'], ['营销', 'marketing'], ['电商', 'ecommerce'], ['浏览器', 'browser'], ['测试', 'testing'], ['前端', 'frontend'], ['开发', 'development'], ['技能', 'skill']];
export function searchTerms(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 140) throw new Error('请输入 1–140 个字符的技能关键词。');
  const matches = translations.filter(([zh]) => value.includes(zh)).map(([, en]) => en);
  const latin = value.match(/[a-zA-Z0-9][a-zA-Z0-9._-]*/g) || [];
  const words = [...new Set([...matches, ...latin].filter(s => s.toLowerCase() !== 'skill'))];
  const terms = words.length ? words.join(' ') : value.trim();
  return terms.replace(/["\\:<>]/g, ' ').replace(/\s+/g, ' ').trim();
}
const validRepo = repo => { if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GitHub 仓库格式无效。'); return repo; };
const repoSummary = r => ({ repo: validRepo(r.full_name), description: r.description || '', url: `https://github.com/${r.full_name}`, stars: r.stargazers_count || 0, updatedAt: r.pushed_at || r.updated_at, defaultBranch: r.default_branch, archived: Boolean(r.archived), license: r.license?.spdx_id || null });

export class Discovery {
  constructor(manager) { this.m = manager; this.cache = new Map(); }
  async cached(key, run, ttl = 5 * 60 * 1000) {
    const entry = this.cache.get(key); if (entry && entry.expires > Date.now()) return entry.value;
    const value = await run(); if (this.cache.size > 80) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, { value, expires: Date.now() + ttl }); return value;
  }
  async repository(repo) { validRepo(repo); return this.cached(`repo:${repo}`, async () => repoSummary(await this.m.github(`/repos/${repo}`))); }
  async inspect(repo, keyword = '', supplied) {
    validRepo(repo); const terms = keyword ? searchTerms(keyword).toLowerCase().split(' ') : [];
    const info = supplied || await this.repository(repo);
    const snapshot = await this.cached(`tree:${repo}`, async () => {
      const source = { repo, ref: info.defaultBranch, path: '' }, commit = await this.m.resolve(source), tree = await this.m.tree(source, commit);
      return { commit, tree };
    });
    const entries = snapshot.tree.filter(f => f.type === 'blob' && f.mode !== '120000' && /(^|\/)SKILL\.md$/.test(f.path));
    const score = text => terms.reduce((n, term) => n + (text.toLowerCase().includes(term) ? 1 : 0), 0);
    entries.sort((a, b) => score(b.path) - score(a.path) || a.path.localeCompare(b.path));
    const skills = [], warnings = [];
    // Bounded inspection is explicit: a repository may contain more matching skills.
    for (const file of entries.slice(0, 6)) {
      try {
        const content = (await this.m.blob(repo, file.sha, 1024 * 1024)).toString('utf8'), meta = metadata(content);
        if (!meta.name || !meta.description) { warnings.push(`${file.path} 缺少必要元数据`); continue; }
        if (terms.length && !score(`${file.path} ${meta.name} ${meta.description}`)) continue;
        const directory = file.path === 'SKILL.md' ? '' : file.path.slice(0, -'/SKILL.md'.length);
        const source = { repo, ref: info.defaultBranch, path: directory };
        const url = `https://github.com/${repo}/tree/${snapshot.commit}${directory ? '/' + directory : ''}`;
        skills.push({ id: `${repo}:${directory}`, name: meta.name, ...classify(meta.name, meta.description), description: meta.description, source, sourceUrl: url, commit: snapshot.commit, repository: info, validation: 'SKILL.md 结构已检查 · 待运行验证' });
      } catch (e) { warnings.push(`${file.path}: ${e.message}`); }
    }
    return { repository: info, skills, discoveredFiles: entries.length, inspectedFiles: Math.min(entries.length, 6), warnings, commit: snapshot.commit };
  }
  async search(query, page = 1) {
    const terms = searchTerms(query); page = Number(page);
    if (!Number.isInteger(page) || page < 1 || page > 5) throw new Error('搜索页码应为 1–5。');
    return this.cached(`search:${terms}:${page}:${this.m.authenticated}`, async () => {
      const warnings = [], skills = [], repositories = [];
      let mode = 'repository-discovery', total = 0, incomplete = false;
      if (this.m.authenticated) {
        try {
          const results = await this.m.github(`/search/code?q=${encodeURIComponent(`${terms} filename:SKILL.md is:public`)}&per_page=12&page=${page}`);
          total = results.total_count; incomplete = results.incomplete_results; mode = 'authenticated-code-search';
          for (const file of results.items) {
            if (!/(^|\/)SKILL\.md$/.test(file.path)) continue;
            try {
              const repo = validRepo(file.repository.full_name), info = await this.repository(repo);
              const meta = metadata((await this.m.blob(repo, file.sha, 1024 * 1024)).toString('utf8'));
              if (!meta.name || !meta.description) continue;
              const directory = file.path === 'SKILL.md' ? '' : file.path.slice(0, -'/SKILL.md'.length);
              const source = { repo, ref: info.defaultBranch, path: directory };
              skills.push({ id: `${repo}:${directory}`, name: meta.name, ...classify(meta.name, meta.description), description: meta.description, source, sourceUrl: `https://github.com/${repo}/tree/${encodeURIComponent(info.defaultBranch)}${directory ? '/' + directory : ''}`, repository: info, validation: '搜索索引结果 · 待运行验证' });
            } catch (e) { warnings.push(`${file.path}: ${e.message}`); }
          }
          return { query, effectiveQuery: terms, page, mode, total, totalType: 'GitHub 代码搜索命中文件', incomplete, skills, repositories, warnings, searchedAt: new Date().toISOString() };
        } catch (e) { warnings.push(`精确代码搜索不可用，已改用公开仓库发现：${e.message}`); }
      }
      const results = await this.m.github(`/search/repositories?q=${encodeURIComponent(`${terms} skill in:name,description,readme archived:false is:public`)}&per_page=5&page=${page}`);
      total = results.total_count; incomplete = results.incomplete_results;
      for (const r of results.items) repositories.push(repoSummary(r));
      for (const info of repositories.slice(0, 3)) {
        try { const result = await this.inspect(info.repo, terms, info); skills.push(...result.skills); warnings.push(...result.warnings); }
        catch (e) { warnings.push(`${info.repo}: ${e.message}`); }
      }
      return { query, effectiveQuery: terms, page, mode, total, totalType: 'GitHub 相关仓库', incomplete, skills: [...new Map(skills.map(s => [s.id, s])).values()], repositories, warnings, inspectedRepositories: Math.min(3, repositories.length), scope: '每页返回 5 个相关仓库，检查前 3 个仓库各最多 6 个 SKILL.md；不是全站完整索引。', searchedAt: new Date().toISOString() };
    });
  }
  async detail(url) {
    const source = parseSource(url), info = await this.repository(source.repo);
    const commit = await this.m.resolve(source), tree = await this.m.tree(source, commit);
    const prefix = source.path ? source.path + '/' : '', skillFile = tree.find(f => f.path === `${prefix}SKILL.md` && f.type === 'blob' && f.mode !== '120000');
    if (!skillFile) throw new Error('目录中没有有效 SKILL.md。');
    const content = (await this.m.blob(source.repo, skillFile.sha, 1024 * 1024)).toString('utf8'), meta = metadata(content);
    if (!meta.name || !meta.description) throw new Error('技能说明缺少名称或描述。');
    const readmes = [...new Set([`${prefix}README.md`, `${prefix}readme.md`, `${prefix}README.zh-CN.md`, 'README.md', 'readme.md'])];
    const introductions = [], warnings = [];
    for (const candidate of readmes) {
      const f = tree.find(f => f.path === candidate && f.type === 'blob' && f.mode !== '120000'); if (!f) continue;
      try { const text = (await this.m.blob(source.repo, f.sha, 512 * 1024)).toString('utf8'); introductions.push({ path: f.path, content: text.slice(0, 32000), truncated: text.length > 32000, url: `https://github.com/${source.repo}/blob/${commit}/${f.path}` }); }
      catch (e) { warnings.push(`README: ${e.message}`); }
      if (introductions.length >= 2) break;
    }
    return { repository: info, source, commit, name: meta.name, description: meta.description, content, sourceUrl: `https://github.com/${source.repo}/tree/${commit}${source.path ? '/' + source.path : ''}`, introductions, warnings, validation: '作者原文 · 未执行技能', imported: Boolean(this.m.catalog.find(s => s.id === `${source.repo}:${source.path}`)) };
  }
}
