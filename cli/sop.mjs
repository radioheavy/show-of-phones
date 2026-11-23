#!/usr/bin/env node
// Show of Phones · command line. No dependencies besides wrangler (for dev/deploy).
//
//   npm run sop new <talk>        start a new talk from the template
//   npm run sop build             assemble dist/ (decks, phone pages, remotes, landing)
//   npm run sop dev               build + run locally (wrangler dev) with live layer
//   npm run sop cloud             check the Cloudflare side: login, account, worker name, address
//   npm run sop deploy            build + deploy to your Cloudflare account (runs the cloud checks first)
//   npm run sop open <talk>       open the deck with the admin key (live layer on)
//   npm run sop remote <talk>     show the phone-remote QR (contains the key: never project it)
//   npm run sop -- key --rotate    show (or rotate) the admin key
//   npm run sop check             validate all talks

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(ROOT, ...a);
const DIST = P('dist');
const SOPDIR = P('.sop');
const require = createRequire(import.meta.url);
const qrcode = require(P('engine/vendor/qrcode.js'));
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, ok: (s) => `\x1b[32m${s}\x1b[0m`, warn: (s) => `\x1b[33m${s}\x1b[0m`, err: (s) => `\x1b[31m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` };
const die = (msg) => { console.error(c.err('✖ ' + msg)); process.exit(1); };
const readJSON = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (fallback !== undefined && e.code === 'ENOENT') return fallback; throw new Error(`${path.relative(ROOT, f)}: ${e.message}`); } };

function config() {
  const base = readJSON(P('sop.config.json'), {});
  const local = readJSON(P('sop.config.local.json'), {});
  const cfg = { worker: '', domains: [], url: '', ...base, ...local };
  if (!cfg.url && cfg.domains.length) cfg.url = `https://${cfg.domains[0]}`;
  return cfg;
}

function adminKey({ create = false, rotate = false } = {}) {
  const f = path.join(SOPDIR, 'admin.key');
  if (!rotate && fs.existsSync(f)) return { key: fs.readFileSync(f, 'utf8').trim(), fresh: false };
  if (!create && !rotate) return { key: '', fresh: false };
  fs.mkdirSync(SOPDIR, { recursive: true });
  const key = 'sop_' + crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(f, key + '\n', { mode: 0o600 });
  return { key, fresh: true };
}

function talks() {
  const dir = P('talks');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(dir, d.name, 'talk.json')))
    .map((d) => d.name);
}

function copyDir(src, dst, skip = () => false) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, skip); else fs.copyFileSync(s, d);
  }
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const inlineJSON = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
function fill(tpl, vars) { return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : '')); }

// What the pages may know about a talk (never notes, never keys).
function publicConfig(slug, t) {
  return { slug, title: t.title || slug, lang: t.lang || 'en', theme: t.theme || 'house', duration: t.duration || 10, links: t.links || [], thanks: t.thanks || '' };
}

function checkTalk(slug) {
  const dir = P('talks', slug);
  const problems = [];
  if (!SLUG_RE.test(slug)) problems.push(`folder name "${slug}" must be lowercase letters, digits and dashes (max 40)`);
  let t = {};
  try { t = readJSON(path.join(dir, 'talk.json')); } catch (e) { problems.push(e.message); }
  const slidesFile = path.join(dir, 'slides.html');
  if (!fs.existsSync(slidesFile)) problems.push('slides.html is missing');
  else {
    const html = fs.readFileSync(slidesFile, 'utf8');
    if (!/<section[^>]*class="[^"]*\bslide\b/.test(html)) problems.push('slides.html has no <section class="slide">');
    for (const m of html.matchAll(/<div[^>]*class="[^"]*\bsop-(poll|swipe)\b[^"]*"[^>]*>/g)) {
      const opts = (m[0].match(/data-options="([^"]*)"/) || [])[1];
      if (!opts || opts.split('|').filter((x) => x.trim()).length < 2) problems.push(`a .sop-${m[1]} needs data-options="A|B" (at least two)`);
      if (m[1] === 'poll' && opts && opts.split('|').length > 6) problems.push('a .sop-poll can have at most 6 options');
    }
    const ids = [...html.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    if (dup.length) problems.push(`duplicate slide data-id: ${[...new Set(dup)].join(', ')}`);
  }
  if (t.lang && !['en', 'tr'].includes(t.lang)) problems.push(`lang "${t.lang}" has no interface strings yet (engine/i18n.js): falls back to English`);
  return { t, problems };
}

function build({ quiet = false } = {}) {
  // Empty dist/ instead of deleting it, so a running `wrangler dev` keeps watching the folder.
  fs.mkdirSync(DIST, { recursive: true });
  for (const e of fs.readdirSync(DIST)) fs.rmSync(path.join(DIST, e), { recursive: true, force: true });
  copyDir(P('engine'), path.join(DIST, '_engine'), (n) => n.endsWith('.html') || n.startsWith('.'));
  const tpl = (n) => fs.readFileSync(P('engine', n), 'utf8');
  const deckTpl = tpl('deck.html'), playTpl = tpl('play.html'), remoteTpl = tpl('remote.html');
  const rooms = {};
  const list = talks();
  for (const slug of list) {
    const { t, problems } = checkTalk(slug);
    const fatal = problems.filter((p) => !p.includes('falls back'));
    if (fatal.length) die(`talks/${slug}:\n  - ${fatal.join('\n  - ')}`);
    const src = P('talks', slug), out = path.join(DIST, slug);
    const pub = publicConfig(slug, t);
    copyDir(path.join(src, 'assets'), path.join(out, 'assets'), (n) => n.startsWith('.'));
    for (const f of ['talk.css', 'talk.js']) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(out, f));
    const vars = {
      LANG: pub.lang, TITLE: escHtml(pub.title), CONFIG: inlineJSON(pub),
      SLIDES: fs.readFileSync(path.join(src, 'slides.html'), 'utf8'),
      TALK_CSS: fs.existsSync(path.join(src, 'talk.css')) ? '<link rel="stylesheet" href="talk.css">' : '',
      TALK_JS: fs.existsSync(path.join(src, 'talk.js')) ? '<script src="talk.js" defer></script>' : '',
      // talk.css is loaded by the phone page and the remote too, so one stylesheet themes all three
      PHONE_CSS: fs.existsSync(path.join(src, 'talk.css')) ? '<link rel="stylesheet" href="../talk.css">' : '',
    };
    fs.writeFileSync(path.join(out, 'index.html'), fill(deckTpl, vars));
    fs.mkdirSync(path.join(out, 'play'), { recursive: true });
    fs.writeFileSync(path.join(out, 'play', 'index.html'), fill(playTpl, vars));
    fs.mkdirSync(path.join(out, 'remote'), { recursive: true });
    fs.writeFileSync(path.join(out, 'remote', 'index.html'), fill(remoteTpl, vars));
    rooms[slug] = {};
  }
  // Landing / website (optional): copied to the root. A site.json "room" gets an always-open interaction + phone page.
  // Lives in ./site, or wherever "site" in sop.config(.local).json points (e.g. a separate private repo).
  const siteDir = path.resolve(ROOT, config().site || 'site');
  if (fs.existsSync(siteDir)) {
    const site = readJSON(path.join(siteDir, 'site.json'), null);
    // Not served: site.json, dotfiles, node_modules, and whatever site.json lists in "private" (e.g. README.md, tools).
    const hidden = new Set(['site.json', 'node_modules', ...((site && site.private) || [])]);
    copyDir(siteDir, DIST, (n) => hidden.has(n) || n.startsWith('.'));
    if (site && site.room) {
      const slug = site.room.slug || 'landing';
      if (rooms[slug]) die(`site.json room "${slug}" clashes with a talk folder`);
      const pub = publicConfig(slug, site.room);
      fs.mkdirSync(path.join(DIST, slug, 'play'), { recursive: true });
      fs.writeFileSync(path.join(DIST, slug, 'play', 'index.html'), fill(playTpl, { LANG: pub.lang, TITLE: escHtml(pub.title), CONFIG: inlineJSON(pub) }));
      rooms[slug] = { open: site.room.open || null };
    }
  }
  // No landing page: the root lists the talks, so a fresh deployment never answers with a bare 404.
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    const items = list.map((slug) => {
      const pub = publicConfig(slug, checkTalk(slug).t);
      return `<li><a href="${slug}/">${escHtml(pub.title)}</a><span>/${slug}/ · phones: /${slug}/play/</span></li>`;
    }).join('\n');
    fs.writeFileSync(path.join(DIST, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Talks</title>
<link rel="stylesheet" href="_engine/theme.css"><style>
body{margin:0;min-height:100vh;background:var(--sop-bg);color:var(--sop-fg);font:18px/1.5 var(--sop-font);display:grid;place-items:center}
main{width:min(640px,100% - 32px);padding:48px 0}h1{font:var(--sop-display-weight) clamp(48px,10vw,88px)/var(--sop-display-leading) var(--sop-display);margin:0 0 32px}
ul{list-style:none;margin:0;padding:0}li{border-top:1px solid var(--sop-line);padding:16px 0;display:grid;gap:2px}
a{color:var(--sop-accent);font-size:24px;font-weight:700;text-decoration:none}a:hover,a:focus-visible{text-decoration:underline}
span{color:var(--sop-muted);font-size:15px}footer{margin-top:40px;color:var(--sop-muted);font-size:14px}footer a{font-size:14px;font-weight:400}
</style></head><body><main><h1>Talks</h1><ul>
${items}
</ul><footer>Made with <a href="https://github.com/radioheavy/show-of-phones">Show of Phones</a></footer></main></body></html>
`);
  }
  fs.mkdirSync(path.join(DIST, '_sop'), { recursive: true });
  fs.writeFileSync(path.join(DIST, '_sop', 'rooms.json'), JSON.stringify({ rooms }, null, 2));
  if (!quiet) console.log(c.ok('✓ built ') + c.dim(path.relative(process.cwd(), DIST) || 'dist') + `  ${list.length} talk(s): ${list.join(', ') || '—'}`);
  return list;
}

function wranglerConfig({ dev = false } = {}) {
  const cfg = config();
  const w = {
    name: cfg.worker || (dev ? 'show-of-phones-local' : ''),
    main: '../worker/index.js',
    compatibility_date: '2025-09-01',
    assets: { directory: '../dist', binding: 'ASSETS', run_worker_first: true, html_handling: 'auto-trailing-slash' },
    durable_objects: { bindings: [{ name: 'ROOM', class_name: 'Room' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['Room'] }],
  };
  if (!dev && cfg.domains.length) w.routes = cfg.domains.map((d) => ({ pattern: d, custom_domain: true }));
  if (cfg.account_id) w.account_id = cfg.account_id;
  fs.mkdirSync(SOPDIR, { recursive: true });
  const f = path.join(SOPDIR, 'wrangler.json');
  fs.writeFileSync(f, JSON.stringify(w, null, 2));
  return f;
}

function wrangler(args, opts = {}) {
  const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return spawnSync(bin, ['wrangler', ...args], { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32', ...opts });
}

/* ---------------- Cloudflare: login, account, worker name, address ---------------- */
const WORKER_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
function saveLocal(patch) {
  const f = P('sop.config.local.json');
  const cur = readJSON(f, {});
  fs.writeFileSync(f, JSON.stringify({ ...cur, ...patch }, null, 2) + '\n');
}
function quiet(args) { return wrangler(args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }); }
function workerExists(name) { return quiet(['deployments', 'list', '--name', name, '--json']).status === 0; }
const deployedMarker = (name) => path.join(SOPDIR, `deployed-${name}`);
// Everything that has to be true before a deploy. Returns problems (strings); empty means ready.
function cloudCheck({ verbose = true } = {}) {
  const say = (s) => verbose && console.log(s);
  const problems = [];
  const who = quiet(['whoami', '--json']);
  let me = null;
  try { me = JSON.parse(who.stdout); } catch {}
  if (who.status !== 0 || !me || !me.loggedIn) {
    problems.push('Not logged in to Cloudflare. Run this yourself (it opens the browser): npx wrangler login');
    return problems;
  }
  const local = readJSON(P('sop.config.local.json'), {});
  const accounts = me.accounts || [];
  say(c.ok('✓ Logged in to Cloudflare') + c.dim(` (${accounts.length} account${accounts.length === 1 ? '' : 's'})`));
  if (accounts.length > 1 && !local.account_id && !process.env.CLOUDFLARE_ACCOUNT_ID) {
    problems.push('This login has several Cloudflare accounts. Pick one: npm run sop -- cloud --account=<id>\n' +
      accounts.map((a) => `      ${a.id}  ${a.name}`).join('\n'));
  } else {
    const acc = accounts.find((a) => a.id === (local.account_id || process.env.CLOUDFLARE_ACCOUNT_ID)) || accounts[0];
    if (acc) say(c.ok('✓ Account: ') + acc.name);
  }
  if (!local.worker) {
    problems.push('Choose a name for your deployment (it becomes part of the address): npm run sop -- cloud --name=<name>\n' +
      '      lowercase letters, digits and dashes, e.g. my-talks or devfest-2026');
  } else if (!WORKER_RE.test(local.worker)) {
    problems.push(`"${local.worker}" is not a valid name: lowercase letters, digits and dashes, max 63.`);
  } else {
    // deployed from this folder before (older versions only left the secret marker)
    const mine = fs.existsSync(deployedMarker(local.worker)) || fs.existsSync(path.join(SOPDIR, `secret-${local.worker}`));
    const exists = workerExists(local.worker);
    if (exists && !mine && !flags.takeover) {
      problems.push(`A deployment called "${local.worker}" already exists on this Cloudflare account, and it was not made from this folder.\n` +
        '      Deploying would replace it. Pick another name (npm run sop -- cloud --name=<name>),\n' +
        '      or, if it really is yours and you want to replace it, add --takeover.');
    } else say(c.ok('✓ Name: ') + local.worker + c.dim(exists ? ' (updates your existing deployment)' : ' (new)'));
  }
  const cfg = config();
  if (cfg.domains.length) say(c.ok('✓ Address: ') + cfg.domains.map((d) => 'https://' + d).join(', ') + c.dim(' (custom domain; its DNS zone must be on this account)'));
  else say(c.ok('✓ Address: ') + (cfg.url || c.dim('a free <name>.<your-subdomain>.workers.dev address, shown after the first deploy')));
  return problems;
}

function freePort(start) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const srv = net.createServer();
      srv.once('error', () => tryPort(p + 1));
      srv.once('listening', () => srv.close(() => resolve(p)));
      srv.listen(p, '127.0.0.1');
    };
    tryPort(start);
  });
}

function openUrl(u) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', u] : [u];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch {}
}

// Terminal QR with half blocks (two rows per line).
function terminalQR(text) {
  const q = qrcode(0, 'L'); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 2;
  const dark = (r, col) => r >= 0 && col >= 0 && r < n && col < n && q.isDark(r, col);
  let out = '';
  for (let r = -m; r < n + m; r += 2) {
    let line = '';
    for (let col = -m; col < n + m; col++) {
      const top = dark(r, col), bot = dark(r + 1, col);
      line += top && bot ? ' ' : top ? '▄' : bot ? '▀' : '█';
    }
    out += line + '\n';
  }
  return out;
}
function svgQR(text, file) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `<?xml version="1.0"?>${q.createSvgTag({ cellSize: 12, margin: 3, scalable: false })}`, { mode: 0o600 });
}

function baseUrl(flags) {
  if (flags.local) { const pf = path.join(SOPDIR, 'dev-port'); return `http://localhost:${fs.existsSync(pf) ? fs.readFileSync(pf, 'utf8').trim() : 8787}`; }
  const cfg = config();
  if (!cfg.url) die('No public URL yet. Add "domains" or "url" to sop.config.local.json (or use --local).');
  return cfg.url.replace(/\/$/, '');
}

function needTalk(slug) {
  if (!slug) die('Which talk? e.g. npm run sop open hello-world');
  if (!talks().includes(slug)) die(`No talk "${slug}". Talks: ${talks().join(', ') || '—'}`);
}

/* ---------------- commands ---------------- */
const [cmd, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true]; }));
const args = rest.filter((a) => !a.startsWith('--'));

switch (cmd) {
  case 'build': build(); break;

  case 'check': {
    let bad = 0;
    for (const slug of talks()) {
      const { problems } = checkTalk(slug);
      if (problems.length) { bad++; console.log(c.warn(`△ ${slug}`)); for (const p of problems) console.log('   - ' + p); }
      else console.log(c.ok(`✓ ${slug}`));
    }
    process.exit(bad ? 1 : 0);
  }

  case 'new': {
    const slug = args[0];
    if (!slug || !SLUG_RE.test(slug)) die('Usage: npm run sop new <talk-name>   (lowercase letters, digits, dashes)');
    const dst = P('talks', slug);
    if (fs.existsSync(dst)) die(`talks/${slug} already exists`);
    copyDir(P('talks', '_template'), dst);
    const tj = path.join(dst, 'talk.json');
    const t = readJSON(tj); t.title = args.slice(1).join(' ') || slug; fs.writeFileSync(tj, JSON.stringify(t, null, 2) + '\n');
    console.log(c.ok(`✓ talks/${slug} created.`) + ' Edit slides.html, then: npm run sop dev');
    break;
  }

  case 'key': {
    const { key, fresh } = adminKey({ create: true, rotate: !!flags.rotate });
    console.log((fresh ? c.ok('New admin key: ') : 'Admin key: ') + c.b(key));
    console.log(c.dim('Stored in .sop/admin.key (git-ignored). Treat it like a password.'));
    if (flags.rotate) console.log(c.warn('Rotated. Run "npm run sop deploy" so the server gets the new key.'));
    break;
  }

  case 'dev': {
    const list = build();
    const { key } = adminKey({ create: true });
    fs.writeFileSync(P('.dev.vars'), `ADMIN_KEY=${key}\n`, { mode: 0o600 });
    const f = wranglerConfig({ dev: true });
    // 8787 is often taken (another dev server): use the first free port and print the real addresses
    const port = Number(flags.port) || await freePort(8787);
    fs.writeFileSync(path.join(SOPDIR, 'dev-port'), String(port));
    console.log(c.b('\nLocal URLs (live layer on):'));
    for (const s of list) console.log(`  ${s}: http://localhost:${port}/${s}/?key=${key}   ${c.dim('phones: http://localhost:' + port + '/' + s + '/play/')}`);
    console.log(c.dim('  Phones on the same Wi-Fi need your computer\'s LAN address: npm run sop -- dev --ip\n'));
    const wargs = ['dev', '-c', f, '--env-file', P('.dev.vars'), '--port', String(port)];
    if (flags.ip) wargs.push('--ip', '0.0.0.0');
    const r = wrangler(wargs);
    process.exit(r.status ?? 0);
  }

  case 'cloud': {
    if (typeof flags.name === 'string') {
      if (!WORKER_RE.test(flags.name)) die('Name: lowercase letters, digits and dashes, max 63 (e.g. my-talks).');
      const before = readJSON(P('sop.config.local.json'), {});
      // a workers.dev address belongs to the old name: forget it (the next deploy prints the new one)
      const stale = before.url && before.worker && before.worker !== flags.name && before.url.includes(`//${before.worker}.`) && before.url.endsWith('.workers.dev');
      saveLocal({ worker: flags.name, ...(stale ? { url: '' } : {}) });
    }
    if (typeof flags.account === 'string') saveLocal({ account_id: flags.account });
    if (typeof flags.domain === 'string') saveLocal({ domains: flags.domain.split(',').map((d) => d.trim()).filter(Boolean), url: '' });
    const problems = cloudCheck();
    if (problems.length) { console.log(''); for (const p of problems) console.log(c.warn('• ' + p)); process.exit(2); }
    console.log(c.ok('\nReady to deploy: npm run sop deploy'));
    break;
  }

  case 'deploy': {
    const problems = cloudCheck({ verbose: false });
    if (problems.length) { for (const p of problems) console.log(c.warn('• ' + p)); die('Not deployed. Fix the points above (npm run sop cloud shows the full check).'); }
    build();
    const { key, fresh } = adminKey({ create: true });
    const f = wranglerConfig();
    let r = wrangler(['deploy', '-c', f], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
    if (r.status !== 0) die('wrangler deploy failed (see above).');
    fs.writeFileSync(deployedMarker(config().worker), new Date().toISOString());
    const dev = (r.stdout || '').match(/https:\/\/[a-z0-9.-]+\.workers\.dev/);
    if (dev && !config().url) saveLocal({ url: dev[0] });
    const marker = path.join(SOPDIR, `secret-${config().worker}`);
    const savedHash = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : '';
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    if (fresh || savedHash !== hash || flags.secret) {
      console.log(c.dim('Uploading ADMIN_KEY secret…'));
      r = wrangler(['secret', 'put', 'ADMIN_KEY', '-c', f], { input: key, stdio: ['pipe', 'inherit', 'inherit'] });
      if (r.status !== 0) die('Could not set the ADMIN_KEY secret.');
      fs.writeFileSync(marker, hash);
    }
    const cfg = config();
    console.log(c.ok('\n✓ Deployed.'));
    if (cfg.url) for (const s of talks()) console.log(`  ${s}: ${cfg.url}/${s}/   ${c.dim('phones: ' + cfg.url + '/' + s + '/play/  · venue screen: ' + cfg.url + '/' + s + '/pair')}`);
    console.log(c.dim('  Open with the key: npm run sop open <talk>   ·   phone remote: npm run sop remote <talk>'));
    break;
  }

  case 'open': {
    needTalk(args[0]);
    const { key } = adminKey();
    if (!key) die('No admin key yet. Run "npm run sop deploy" (or "npm run sop dev") first.');
    const u = `${baseUrl(flags)}/${args[0]}/?key=${encodeURIComponent(key)}`;
    console.log('Opening the deck with the live layer on. ' + c.dim('(the key is remembered in that browser)'));
    openUrl(u);
    break;
  }

  case 'remote': {
    needTalk(args[0]);
    const { key } = adminKey();
    if (!key) die('No admin key yet. Run "npm run sop deploy" (or "npm run sop dev") first.');
    const u = `${baseUrl(flags)}/${args[0]}/remote/?key=${encodeURIComponent(key)}`;
    console.log(c.warn('⚠ This QR contains your admin key. Never project it, never share it.\n'));
    console.log(terminalQR(u));
    const svg = path.join(SOPDIR, `remote-${args[0]}.svg`);
    svgQR(u, svg);
    console.log(`Scan with your phone. ${c.dim('Same QR as an image: ' + path.relative(process.cwd(), svg))}`);
    if (flags.show) openUrl(svg);
    break;
  }

  default:
    console.log(`${c.b('Show of Phones')} ${c.dim('· turn your talk into a game the room plays')}

  npm run sop new <talk> [title]   start a new talk from the template
  npm run sop dev [--ip]           run locally with the live layer
  npm run sop cloud                check login, account, name and address
  npm run sop -- cloud --name=<n>  choose the deployment name (also --account=<id>, --domain=<host>)
  npm run sop deploy               deploy to your Cloudflare account
  npm run sop open <talk>          open the deck with the admin key
  npm run sop remote <talk>        phone-remote QR (contains the key!) [--show]
  npm run sop -- key [--rotate]    show or rotate the admin key
  npm run sop check                validate talks
  npm run sop build                assemble dist/ only

  Talks: ${talks().join(', ') || '—'}`);
}
