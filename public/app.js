const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token, data, tab = 'market', category = '全部', query = '', sort = 'default', current, pendingConfirm;
let githubResults = null, githubQuery = '', githubPage = 1, githubLoading = false, githubError = '', detailSequence = 0;
const categories = ['全部', '办公文档', '开发工具', '设计创意', '数据分析', '内容创作', '影视制作', '音视频', '知识管理', '营销运营', '通用工具'];
async function api(route, body) {
  const response = await fetch('/api/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Shelf-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || '操作失败。'); return value;
}
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 6500); }
async function busy(button, fn) { button.disabled = true; const old = button.textContent; button.textContent = '处理中…'; try { await fn(); } catch (e) { toast(e.message); } finally { button.disabled = false; button.textContent = old; } }
async function refresh() { data = await api('overview'); render(); }
function render() {
  $('#market-count').textContent = data.catalog.length; $('#local-count').textContent = data.local.items.length; $('#favorite-count').textContent = data.favorites.length;
  $('#sync-time').textContent = data.lastSync ? `上次同步 ${new Date(data.lastSync).toLocaleString('zh-CN', { hour12: false })}` : '随附目录快照 · 点击同步获取最新版本';
  $('#notice').hidden = !data.local.warnings.length; $('#notice').textContent = data.local.warnings.length ? `有 ${data.local.warnings.length} 个目录无法读取，扫描结果可能不完整。` : '';
  document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  $('#github-panel').hidden = tab !== 'github'; $('#categories').hidden = tab === 'github';
  $('.tools .search').hidden = tab === 'github'; $('#sort').hidden = tab === 'github';
  if (tab === 'github') return renderGithub();
  const base = tab === 'local' ? data.local.items : data.catalog.filter(s => tab !== 'favorites' || data.favorites.includes(s.id));
  $('#categories').innerHTML = categories.map(c => `<button class="chip ${c === category ? 'active' : ''}" data-category="${c}">${c}${c === '全部' ? ` <span>${base.length}</span>` : ''}</button>`).join('');
  let items = base.filter(s => (category === '全部' || s.category === category) && [s.title, s.name, s.summary, s.description, s.source?.repo, s.category].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase()));
  if (sort !== 'default') items.sort((a, b) => (sort === 'name' ? a.title : a.category).localeCompare(sort === 'name' ? b.title : b.category, 'zh-CN'));
  $('#section-title').textContent = tab === 'local' ? '你的本地技能与插件资源' : tab === 'favorites' ? '留给下次灵感的技能' : '为你的工作，找到合适的技能';
  $('#result-count').textContent = `${items.length} 个技能`;
  $('#grid').innerHTML = items.length ? items.map((s, i) => {
    const isLocal = tab === 'local', installed = data.installs[s.id], saved = data.favorites.includes(s.id);
    return `<article class="card"><div class="card-head"><span class="skill-icon tone-${categories.indexOf(s.category) % 6}">${esc(s.icon)}</span><div class="card-title"><button class="title-button" data-detail="${esc(s.id)}" title="${esc(s.title)}">${esc(s.title)}</button><div class="skill-name">${esc(s.name)}</div></div><button class="card-action" data-detail="${esc(s.id)}">${isLocal ? '查看' : installed ? '已安装' : '详情'}</button></div><p class="description">${esc(s.summary || s.description)}</p><div class="card-bottom"><div class="badges"><span class="badge">${esc(s.category)}</span><span class="badge source">${esc(isLocal ? s.scope : s.official ? 'OpenAI 来源' : '社区来源')}</span></div>${isLocal ? '' : `<button class="star ${saved ? 'saved' : ''}" data-star="${esc(s.id)}" aria-label="${saved ? '取消收藏' : '收藏'} ${esc(s.title)}" aria-pressed="${saved}">${saved ? '★' : '☆'}</button>`}</div></article>`;
  }).join('') : `<div class="empty">${tab === 'favorites' ? '还没有匹配的收藏。点击卡片上的 ☆，建立你的技能书架。' : '没有找到匹配的技能。试试其他分类或搜索词。'}</div>`;
}
function confirmAction(title, text) {
  $('#confirm-title').textContent = title; $('#confirm-text').textContent = text; $('#confirm-dialog').showModal();
  return new Promise(resolve => { pendingConfirm = resolve; });
}
function closeConfirm(value = false) { $('#confirm-dialog').close(); pendingConfirm?.(value); pendingConfirm = null; }
$('#confirm-ok').onclick = () => closeConfirm(true); $('#confirm-cancel').onclick = () => closeConfirm(false);
$('#confirm-dialog').addEventListener('cancel', () => { pendingConfirm?.(false); pendingConfirm = null; });
document.querySelectorAll('.close').forEach(b => b.onclick = () => { const d = b.closest('dialog'); d.id === 'confirm-dialog' ? closeConfirm() : d.close(); });
async function showDetail(id) {
  detailSequence++;
  const local = data.local.items.find(s => s.id === id), catalog = data.catalog.find(s => s.id === id), s = catalog || local;
  current = null;
  $('#detail-content').innerHTML = `<h2>${esc(s.title)}</h2><p class="muted">${esc(s.summary || s.description)}</p><div class="detail-info"><div><span>技能标识</span>${esc(s.name)}</div><div><span>分类</span>${esc(s.category)}</div><div><span>安装位置</span><code>${esc(local?.directory || data.target)}</code></div><div><span>验证状态</span>${catalog ? '来源可追溯 · 待运行验证' : '本地发现 · 未检测执行效果'}</div></div><div id="preview"><p class="muted">${catalog ? '正在读取上游文件与许可证信息…' : '此技能由外部安装或插件提供，管理器仅展示。插件缓存存在不代表该插件已启用。'}</p></div>`;
  $('#detail').showModal();
  if (!catalog) return;
  try {
    const plan = await api('preview', { id });
    if (!$('#detail').open || !$('#preview') || $('#detail-content h2').textContent !== s.title) return;
    current = { plan, skill: s };
    const installed = data.installs[id];
    $('#preview').innerHTML = `<p class="small muted">${plan.files.length} 个文件 · ${Math.ceil(plan.files.reduce((n, f) => n + f.size, 0) / 1024)} KB · 固定版本 ${esc(plan.commit.slice(0, 12))}</p><h3>上游用途说明</h3><p class="muted small">${esc(plan.meta.description)}</p><h3>许可证</h3><p class="small">${plan.license.length ? plan.license.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noreferrer">${esc(l.path)} ↗</a>`).join(' · ') : '未找到标准许可证文件，请自行核实使用与分发授权。'}</p>${plan.executableFiles.length ? `<div class="notice">包含 ${plan.executableFiles.length} 个脚本或可执行文件。安装仅复制文件，不执行；实际使用前请检查依赖和脚本内容。</div>` : ''}<details><summary>查看文件清单</summary><div class="file-list">${plan.files.map(f => esc(f.path)).join('<br>')}</div></details><details><summary>阅读原始 SKILL.md（上游内容）</summary><pre>${esc(plan.content)}</pre></details><p class="muted small">安装到当前管理器项目的 .agents/skills。只有在这个项目范围内使用 Codex 时才会发现这些技能。</p><div class="actions"><button class="primary" id="install-action">${installed ? installed.commit === plan.commit ? '重新安装此版本' : '安装更新' : '安装到当前项目'}</button>${installed ? `<button class="outline" id="uninstall-action">卸载</button>${installed.backup ? '<button class="outline" id="rollback-action">回退上一版本</button>' : ''}` : ''}<a href="${esc(s.sourceUrl)}" target="_blank" rel="noreferrer">查看来源 ↗</a></div>`;
    $('#install-action').onclick = e => busy(e.currentTarget, async () => {
      if (!await confirmAction(installed ? '更新项目技能' : '安装项目技能', `将下载并写入 ${plan.target}。安装包含目录中的全部文件，不执行脚本。请确认已查看用途、依赖和授权。`)) return;
      const result = await api('install', { token: plan.token }); $('#detail').close(); toast(result.message); await refresh();
    });
    for (const action of ['uninstall', 'rollback']) { const b = $(`#${action}-action`); if (b) b.onclick = e => busy(e.currentTarget, async () => { if (!await confirmAction(action === 'uninstall' ? '卸载技能' : '回退技能', action === 'uninstall' ? '移出项目技能目录并归档文件。检测到本地修改时会停止。' : '恢复上一安装版本。检测到本地修改时会停止。')) return; const r = await api(action, { id }); $('#detail').close(); toast(r.message); await refresh(); }); }
  } catch (e) { if ($('#preview')) $('#preview').innerHTML = `<div class="notice">${esc(e.message)}<br>目录仍可浏览，重新打开详情可重试。</div><a href="${esc(s.sourceUrl)}" target="_blank" rel="noreferrer">查看上游说明 ↗</a>`; }
}
$('#grid').onclick = e => {
  const github = e.target.closest('[data-github-detail]'); if (github) return showGithubDetail(github.dataset.githubDetail);
  const star = e.target.closest('[data-star]'); if (star) return busy(star, async () => { data.favorites = await api('favorite', { id: star.dataset.star }); render(); });
  const detail = e.target.closest('[data-detail]'); if (detail) showDetail(detail.dataset.detail);
};
$('#categories').onclick = e => { const c = e.target.closest('[data-category]'); if (c) { category = c.dataset.category; render(); } };
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; category = '全部'; render(); });
$('#search').oninput = e => { query = e.target.value; render(); }; $('#sort').onchange = e => { sort = e.target.value; render(); };
$('#sync').onclick = e => busy(e.currentTarget, async () => { const r = await api('sync', {}); await refresh(); toast(`已同步 ${r.count} 个真实技能。${r.metadataWarnings.length ? `其中 ${r.metadataWarnings.length} 个用途说明暂未获取，可打开详情重试。` : ''}`); });
$('#import').onclick = () => $('#import-dialog').showModal();
$('#import-form').onsubmit = e => { e.preventDefault(); busy(e.submitter, async () => { const s = await api('import', { url: $('#source-url').value.trim() }); await refresh(); $('#import-dialog').close(); tab = 'market'; category = '全部'; query = s.name; $('#search').value = query; render(); toast('已导入目录。打开详情检查后可安装。'); }); };
$('#help').onclick = () => { $('#detail-content').innerHTML = `<h2>认识你的技能书架</h2><p class="muted">市场目录来自 OpenAI 公开技能仓库及你导入的 GitHub 目录。中文精选介绍由本项目整理，其他技能采用名称和描述规则分类。</p><h3>验证标识</h3><p class="muted">来源可追溯不等于运行已通过。安装前会检查 SKILL.md、文件大小、符号链接和下载完整性；本版本不自动执行技能，也不把这些检查称为安全认证。</p><h3>技能在哪里生效？</h3><p class="muted">默认安装到本项目的 .agents/skills。请在此项目范围内使用 Codex。个人技能和插件缓存只读扫描，不能通过这里卸载。插件缓存存在不代表插件已启用。</p><h3>安装、更新与回退</h3><p class="muted">安装固定到预览的 commit，有效期 15 分钟。更新保留上一个版本；如果已安装文件被修改，会停止覆盖。卸载也会归档原文件。文件备份位于 data/backups。</p><h3>网络与隐私</h3><p class="muted">应用只监听 127.0.0.1。扫描结果保留在本机，请求 GitHub 时不会上传你的技能内容。本版本使用 GitHub 未认证接口，可能遇到请求频率限制。</p>`; $('#detail').showModal(); };
document.addEventListener('keydown', e => { if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { e.preventDefault(); $('#search').focus(); } });
function renderGithub() {
  $('#section-title').textContent = '从 GitHub 发现技能';
  $('#result-count').textContent = githubResults ? `${githubResults.skills.length} 个已识别技能` : '';
  const warnings = [githubError, ...(githubResults?.warnings || [])].filter(Boolean);
  $('#notice').hidden = !warnings.length;
  $('#notice').textContent = warnings.join('；');
  $('#github-meta').textContent = githubResults ? `实际查询：${githubResults.effectiveQuery || githubQuery} · ${githubResults.totalType || '仓库内技能'} ${githubResults.total ?? githubResults.discoveredFiles ?? ''} · ${githubResults.mode === 'authenticated-code-search' ? '已认证文件搜索' : githubResults.scope || '仓库目录检查'}${githubResults.incomplete ? ' · GitHub 标记结果不完整' : ''}` : '公开仓库搜索无需登录。搜索结果不会自动安装。';
  $('#github-repositories').innerHTML = githubResults?.repositories?.length ? `<div class="repo-list">${githubResults.repositories.map(r => `<button class="repo-pill" data-repo="${esc(r.repo)}" title="${esc(r.description)}">${esc(r.repo)}<small>☆ ${r.stars.toLocaleString()}</small></button>`).join('')}</div>` : '';
  $('#github-next').hidden = !githubResults?.mode || githubResults.mode === 'repository-inspection' || githubResults.page >= 5 || githubResults.page * (githubResults.mode === 'authenticated-code-search' ? 12 : 5) >= githubResults.total;
  $('#github-next').textContent = githubResults?.mode === 'authenticated-code-search' ? '下一页技能文件' : '下一页相关仓库';
  $('#grid').innerHTML = githubLoading ? '<div class="empty">正在搜索 GitHub 并识别 SKILL.md，请稍候…</div>' : !githubResults ? '<div class="empty">输入用途或技能名称，开始搜索 GitHub。<br>支持常见中文关键词，也可以直接输入英文关键词。</div>' : !githubResults.skills.length ? '<div class="empty">这次有限扫描没有找到匹配的技能文件。<br>可检查上方相关仓库、尝试下一页，或调整关键词。</div>' : githubResults.skills.map(s => `<article class="card github-card"><div class="card-head"><span class="skill-icon">${esc(s.icon)}</span><div class="card-title"><button class="title-button" data-github-detail="${esc(s.sourceUrl)}">${esc(s.title)}</button><div class="skill-name">${esc(s.repository.repo)}</div></div><button class="card-action" data-github-detail="${esc(s.sourceUrl)}">作者介绍</button></div><p class="description">${esc(s.description)}</p><div class="card-bottom"><div class="badges"><span class="badge">${esc(s.category)}</span><span class="badge source">☆ ${s.repository.stars.toLocaleString()}</span><span class="badge">${data.catalog.some(c => c.id === s.id) ? '已收集' : 'GitHub 发现'}</span></div><a class="small" href="${esc(s.sourceUrl)}" target="_blank" rel="noreferrer">来源 ↗</a></div></article>`).join('');
}
async function githubSearch(page = 1) {
  if (githubLoading) return;
  githubQuery = $('#github-query').value.trim(); if (!githubQuery) return toast('请输入技能关键词。');
  githubLoading = true; githubError = ''; renderGithub();
  const button = $('#github-search-form button'); button.disabled = true;
  try { githubResults = await api('github/search', { query: githubQuery, page }); githubPage = page; }
  catch (e) { githubError = e.message; toast(e.message); }
  finally { githubLoading = false; button.disabled = false; render(); }
}
$('#github-search-form').onsubmit = e => { e.preventDefault(); githubSearch(1); };
$('#github-next').onclick = () => githubSearch(githubPage + 1);
$('#github-repositories').onclick = e => {
  const b = e.target.closest('[data-repo]'); if (!b) return;
  busy(b, async () => { const r = await api('github/repository', { repo: b.dataset.repo, query: githubQuery }); githubResults = { ...r, mode: 'repository-inspection', repositories: [r.repository] }; renderGithub(); });
};
async function showGithubDetail(url) {
  const sequence = ++detailSequence;
  $('#detail-content').innerHTML = '<h2>正在读取 GitHub 作者介绍…</h2><p class="muted">正在获取仓库简介、技能说明和 README 原文。</p>';
  $('#detail').showModal();
  try {
    const d = await api('github/detail', { url }); if (sequence !== detailSequence || !$('#detail').open) return;
    $('#detail-content').innerHTML = `<h2>${esc(d.name)}</h2><p class="upstream-intro">${esc(d.description)}</p><div class="detail-info"><div><span>GitHub 仓库</span><a href="${esc(d.repository.url)}" target="_blank" rel="noreferrer">${esc(d.repository.repo)} ↗</a></div><div><span>Stars / 许可证标识</span>☆ ${d.repository.stars.toLocaleString()} · ${esc(d.repository.license || '未声明')}</div><div><span>仓库最近推送</span>${d.repository.updatedAt ? esc(new Date(d.repository.updatedAt).toLocaleString('zh-CN', { hour12: false })) : '未提供'}</div><div><span>已读取版本</span><code>${esc(d.commit.slice(0, 12))}</code></div></div><h3>GitHub 仓库简介（作者原文）</h3><p class="upstream-intro">${esc(d.repository.description || '作者未填写仓库简介。')}</p>${d.introductions.map(r => `<h3>${esc(r.path)}${r.truncated ? '（节选）' : ''}</h3><pre>${esc(r.content)}</pre><a class="small" href="${esc(r.url)}" target="_blank" rel="noreferrer">在 GitHub 阅读此说明 ↗</a>`).join('') || '<p class="muted">未发现可读取的 README，技能用途见上方作者描述与下方 SKILL.md。</p>'}<details><summary>阅读完整 SKILL.md（作者原文）</summary><pre>${esc(d.content)}</pre></details><p class="muted small">以上来自 GitHub 作者，尚未运行验证。加入书架会保存技能来源，安装可在书架中单独操作。</p>${d.warnings.length ? `<div class="notice">${esc(d.warnings.join('；'))}</div>` : ''}<div class="actions"><button id="collect-github" class="primary">${d.imported ? '刷新书架中的技能' : '收集到我的书架'}</button><a href="${esc(d.sourceUrl)}" target="_blank" rel="noreferrer">查看技能来源 ↗</a></div>`;
    $('#collect-github').onclick = e => busy(e.currentTarget, async () => {
      await api('import', { url: d.sourceUrl }); await refresh(); $('#detail').close(); toast('已收集到市场目录，可搜索、收藏或继续查看安装预览。');
    });
  } catch (e) { if (sequence === detailSequence && $('#detail').open) $('#detail-content').innerHTML = `<h2>GitHub 介绍暂时无法读取</h2><div class="notice">${esc(e.message)}</div>`; }
}
try { token = (await (await fetch('/api/session')).json()).token; await refresh(); } catch (e) { $('#grid').innerHTML = `<div class="empty">无法读取工作台：${esc(e.message)}。请刷新页面重试。</div>`; }
