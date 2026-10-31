import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { Manager } from '../lib/manager.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { const m = await new Manager(root).init(); const result = await m.sync(); await fs.writeFile(path.join(root, 'catalog.snapshot.json'), JSON.stringify(m.catalog, null, 2)); console.log(JSON.stringify(result)); } catch (e) { console.error(e.message); process.exitCode = 1; }
