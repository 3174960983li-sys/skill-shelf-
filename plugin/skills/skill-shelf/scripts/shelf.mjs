const port = Number(process.env.SKILL_SHELF_PORT || 4318);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SKILL_SHELF_PORT');
const endpoint = `http://127.0.0.1:${port}`;
try {
  const session = await (await fetch(endpoint + '/api/session', { signal: AbortSignal.timeout(5000) })).json();
  const api = async (route, body) => {
    const response = await fetch(endpoint + '/api/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Shelf-Token': session.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(180000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Service rejected request'); return result;
  };
  const mode = process.argv[2] || 'search', args = process.argv.slice(3), query = args.join(' ');
  let result;
  if (['search', 'github'].includes(mode)) result = await api('github/search', { query });
  else if (mode === 'detail') result = await api('github/detail', { url: args[0] });
  else if (mode === 'collect') result = await api('import', { url: args[0] });
  else if (mode === 'repo') result = await api('github/repository', { repo: args[0], query: args.slice(1).join(' ') });
  else if (['local', 'status'].includes(mode)) {
    const data = await api('overview');
    result = { target: data.target, results: mode === 'status' ? data.local.items : data.catalog.filter(s => [s.name, s.title, s.category, s.summary, s.description].join(' ').toLowerCase().includes(query.toLowerCase())) };
  } else throw new Error('Commands: search <keywords> | detail <GitHub-directory-URL> | collect <URL> | repo <owner/repo> [keywords] | local <keywords> | status');
  console.log(JSON.stringify({ endpoint, ...result }, null, 2));
} catch (e) { console.error(`Skill Shelf: ${e.message}. If the service is offline, launch Start-Skill-Shelf.cmd from the original project.`); process.exitCode = 1; }
