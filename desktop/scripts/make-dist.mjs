// ============================================================
// Build desktop/dist from the web repo: solo runs fully offline from bundled
// assets; ONLINE navigates the webview to the deployed server (so the ws://
// URL derives from location.host exactly like the browser build).
//
//   GAME_SERVER_URL=https://your-deploy.example node scripts/make-dist.mjs
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');       // web repo root
const desktop = path.resolve(here, '..');
const dist = path.join(desktop, 'dist');

const SERVER_URL = (process.env.GAME_SERVER_URL || 'https://human-error.example').replace(/\/+$/, '');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// game assets — index.html (solo), mp.html, client/, engine/
for (const f of ['index.html', 'mp.html']) fs.copyFileSync(path.join(repo, f), path.join(dist, f));
for (const dir of ['client', 'engine']) {
  fs.cpSync(path.join(repo, dir), path.join(dist, dir), { recursive: true });
}

// launcher (the app's start page) with the server URL baked in
const launcher = fs.readFileSync(path.join(desktop, 'src', 'launcher.html'), 'utf8')
  .replaceAll('%%GAME_SERVER_URL%%', SERVER_URL);
fs.writeFileSync(path.join(dist, 'launcher.html'), launcher);

console.log('dist ready — server:', SERVER_URL);
