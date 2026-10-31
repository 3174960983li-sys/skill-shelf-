import { createHash } from 'node:crypto';

export const officialSource = { repo: 'openai/skills', ref: 'main', path: 'skills/.curated' };
const curated = {
  'aspnet-core': ['ASP.NET 应用开发', '开发工具', '构建和维护 ASP.NET Core 应用。', '⌘'],
  'chatgpt-apps': ['ChatGPT 应用开发', '开发工具', '构建连接工具服务的 ChatGPT 应用。', '◎'],
  'cli-creator': ['命令行工具设计', '开发工具', '设计和实现易用的命令行工具。', '›_'],
  'cloudflare-deploy': ['Cloudflare 部署', '开发工具', '将应用和服务部署到 Cloudflare。', '☁'],
  'define-goal': ['目标规划', '通用工具', '定义明确的目标，组织持续执行的工作。', '◉'],
  'figma-code-connect-components': ['Figma 组件映射', '设计创意', '建立 Figma 设计组件与代码组件的关联。', '◈'],
  'figma-create-design-system-rules': ['设计系统规范', '设计创意', '为设计到代码的工作建立项目规范。', '▦'],
  'figma-create-new-file': ['Figma 新建文件', '设计创意', '创建 Figma 设计、白板或演示文件。', '＋'],
  'figma-generate-design': ['Figma 页面生成', '设计创意', '把应用页面和布局转换为 Figma 设计。', '◈'],
  'figma-generate-library': ['Figma 设计组件库', '设计创意', '组织设计变量、组件和可复用设计系统。', '▦'],
  'figma-use': ['Figma 画布操作', '设计创意', '在 Figma 文件中执行设计操作。', '◈'],
  'gh-address-comments': ['GitHub 评审处理', '开发工具', '整理并处理拉取请求中的评审意见。', '⌥'],
  'hatch-pet': ['桌面宠物创作', '设计创意', '创作可用于桌面陪伴体验的宠物形象。', '♧'],
  'migrate-to-codex': ['迁移到 Codex', '开发工具', '协助把已有开发工作流迁移到 Codex。', '↗'],
  'netlify-deploy': ['Netlify 网站部署', '开发工具', '发布网站并管理 Netlify 部署。', '◇'],
  'notion-knowledge-capture': ['Notion 知识归档', '知识管理', '将讨论与资料整理为可检索的知识。', 'N'],
  'notion-meeting-intelligence': ['Notion 会议准备', '知识管理', '整理会议背景、议程和后续行动。', 'N'],
  'playwright-interactive': ['交互式浏览器调试', '开发工具', '持续操作浏览器并调试网页交互。', '↗'],
  'render-deploy': ['Render 应用部署', '开发工具', '在 Render 上部署和运行应用。', '☁'],
  'security-ownership-map': ['安全责任梳理', '开发工具', '分析代码与维护者之间的安全责任关系。', '◇'],
  'security-threat-model': ['安全威胁建模', '开发工具', '识别应用边界、潜在威胁和缓解措施。', '◇'],
  'sentry': ['Sentry 错误诊断', '开发工具', '查看错误与运行问题，辅助定位故障。', '⌁'],
  'vercel-deploy': ['Vercel 网站部署', '开发工具', '将网站和应用发布到 Vercel。', '△'],
  'winui-app': ['Windows 应用开发', '开发工具', '构建和迭代 WinUI 桌面应用。', '▣'],
  'yeet': ['GitHub 提交工作流', '开发工具', '组织暂存、提交、推送与拉取请求操作。', '⌥'],
  'pdf': ['PDF 文档处理', '办公文档', '读取、生成与检查 PDF 文档。', '▤'],
  'doc': ['Word 文档制作', '办公文档', '创建、编辑和检查 Word 文档的版式。', 'W'],
  'spreadsheet': ['电子表格助手', '数据分析', '创建与分析表格，处理公式、格式和图表。', '▦'],
  'slides': ['演示文稿制作', '办公文档', '制作和编辑演示文稿，检查页面效果。', '▥'],
  'imagegen': ['AI 图像创作', '设计创意', '生成或编辑图片，制作视觉素材。', '✧'],
  'figma': ['Figma 设计协作', '设计创意', '读取设计上下文，连接设计与开发。', '◈'],
  'figma-implement-design': ['Figma 设计还原', '设计创意', '将 Figma 设计实现为应用界面。', '◈'],
  'playwright': ['浏览器自动化', '开发工具', '自动操作浏览器并验证页面行为。', '↗'],
  'screenshot': ['屏幕截图', '开发工具', '按需捕获屏幕，辅助检查应用界面。', '▣'],
  'jupyter-notebook': ['Jupyter 笔记本', '数据分析', '创建与编辑用于实验和分析的笔记本。', '◉'],
  'security-best-practices': ['代码安全实践', '开发工具', '检查代码中的安全实践并提出改进。', '◇'],
  'develop-web-game': ['网页游戏开发', '开发工具', '构建网页游戏，迭代交互与运行效果。', '⌘'],
  'speech': ['语音生成', '音视频', '将文本转换为语音内容。', '♫'],
  'transcribe': ['音频转文字', '音视频', '将录音整理为可阅读的文本。', '≋'],
  'sora': ['视频创作', '音视频', '组织视频生成与素材相关任务。', '▷'],
  'notion-research-documentation': ['Notion 研究整理', '知识管理', '整理工作区资料，形成有来源的研究文档。', 'N'],
  'notion-spec-to-implementation': ['需求落地计划', '知识管理', '把 Notion 需求转换为实施任务和计划。', 'N'],
  'linear': ['Linear 项目协作', '知识管理', '围绕项目、任务与团队协作开展工作。', '◒'],
  'gh-fix-ci': ['GitHub CI 修复', '开发工具', '定位持续集成失败并组织修复。', '⌥'],
  'openai-docs': ['OpenAI 官方文档', '开发工具', '查阅 OpenAI 产品和开发接口文档。', '◎'],
};

export function classify(name, description = '') {
  if (curated[name]) { const [title, category, summary, icon] = curated[name]; return { title, category, summary, icon, translation: '人工整理' }; }
  const t = `${name} ${description}`.toLowerCase();
  const groups = [ ['音视频', /video|audio|speech|transcri|sora|视频|音频|配音/, '▷'], ['影视制作', /storyboard|director|film|分镜|导演|剧本/, '▧'], ['设计创意', /design|figma|image|art|设计|图像/, '✧'], ['数据分析', /data|spreadsheet|analytics|csv|数据|表格/, '▦'], ['办公文档', /document|slides|pdf|word|文档|演示/, '▤'], ['营销运营', /marketing|commerce|social|广告|营销|运营/, '↗'], ['知识管理', /notion|meeting|research|知识|会议|研究/, '◈'], ['开发工具', /code|deploy|github|test|web|开发|代码|编程/, '⌘'] ];
  const g = groups.find(([, re]) => re.test(t));
  return { title: name, category: g?.[0] || '通用工具', summary: description || '打开详情，查看上游技能说明。', icon: g?.[2] || '◇', translation: '规则分类' };
}

// Parse only descriptive frontmatter; skill instructions are never executed.
export function metadata(text) {
  const block = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || '';
  const get = key => {
    const lines = block.split(/\r?\n/); const i = lines.findIndex(l => l.startsWith(`${key}:`));
    if (i < 0) return '';
    let value = lines[i].slice(key.length + 1).trim();
    if (/^[>|][-+]?$/.test(value) || !value) { value = lines.slice(i + 1).filter((l, j, a) => a.slice(0, j + 1).every(v => /^\s|^$/.test(v))).join(' ').trim(); }
    return value.replace(/^(["'])([\s\S]*)\1$/, '$2').slice(0, 5000);
  };
  return { name: get('name'), description: get('description') };
}

export function gitHash(buffer) { return createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex'); }
export function fingerprint(files) { return createHash('sha256').update(JSON.stringify(files.map(f => [f.path, f.sha]).sort())).digest('hex'); }
export function parseSource(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.username || u.password || u.search || u.hash) throw new Error('请输入公开 GitHub 技能目录的 HTTPS 链接。');
  const p = u.pathname.replace(/\/$/, '').split('/').slice(1).map(decodeURIComponent);
  if (p.length < 4 || p[2] !== 'tree') throw new Error('链接格式应为 https://github.com/作者/仓库/tree/main/技能目录；根目录可省略技能目录，含斜杠的分支请改用 commit SHA。');
  if (p.some(s => !s || s === '.' || s === '..' || /[\\\x00-\x1f]/.test(s))) throw new Error('目录格式无效。');
  if (!p.slice(0, 2).every(s => /^[\w.-]+$/.test(s))) throw new Error('仓库名格式无效。');
  return { repo: `${p[0]}/${p[1]}`, ref: p[3], path: p.slice(4).join('/') };
}
