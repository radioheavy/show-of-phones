// Show of Phones · audience phone. Polls the room, shows whatever the big screen has opened:
// a poll, a swipe card, a tap race, or a thank-you screen.
(function () {
  'use strict';
  const T = window.SOP_T, NUM = window.SOP_NUM;
  const CFG = window.SOP_TALK || {};
  const API = `/api/${CFG.slug}`;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
  const COLORS = ['var(--sop-c1)', 'var(--sop-c2)', 'var(--sop-c3)', 'var(--sop-c4)', 'var(--sop-c5)', 'var(--sop-c6)'];

  let id = '';
  try { id = localStorage.getItem('sop-id') || ''; } catch {}
  if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); try { localStorage.setItem('sop-id', id); } catch {} }

  // static text
  document.title = CFG.title || document.title;
  $('title').textContent = CFG.title || '';
  $('idleTitle').textContent = T('phone.title');
  $('idleNowLbl').textContent = T('phone.now');
  $('idleWait').textContent = T('phone.wait');
  $('idlePl').textContent = T('phone.room');
  $('seatLbl').textContent = T('phone.seat');
  $('idleShow').textContent = CFG.title || '';
  $('pollHint').textContent = T('phone.pick');
  $('swipeHint').textContent = T('phone.swipe');
  $('tapWord').textContent = T('phone.tap');
  $('myTapsLbl').textContent = T('phone.yourTaps');
  $('roomTapsLbl').textContent = T('phone.roomTaps');
  $('endTitle').textContent = CFG.thanks || T('phone.end');
  $('offline').textContent = T('phone.offline');
  $('links').innerHTML = (CFG.links || []).map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.url)}</a></li>`).join('');
  $('credit').innerHTML = T('phone.madeWith').replace('{x}', '<a href="https://github.com/radioheavy/show-of-phones" style="color:inherit">Show of Phones</a>');
  const meta = document.querySelector('meta[name=theme-color]');
  meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--sop-bg').trim() || '#1e1233');

  let S = { live: { type: 'none' }, counts: [], taps: 0, players: 0 };
  let mine = {}; // live id -> my choice
  let myTaps = 0, pending = 0, fails = 0, lastType = '', lastLive = '';
  const tapsBy = {}; // live id -> my taps in that race
  try { Object.assign(mine, JSON.parse(sessionStorage.getItem('sop-mine') || '{}')); Object.assign(tapsBy, JSON.parse(sessionStorage.getItem('sop-taps') || '{}')); } catch {}
  const keep = () => { try { sessionStorage.setItem('sop-mine', JSON.stringify(mine)); sessionStorage.setItem('sop-taps', JSON.stringify(tapsBy)); } catch {} };
  $('vLbl').textContent = T('phone.verdict');
  const post = (p, body) => fetch(`${API}/${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, ...body }) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  // The live moment that just closed on the current slide (its result stays on the phone until the slide changes).
  function closedHere() {
    const sc = S.scene, res = S.results || {};
    if (!sc) return null;
    let best = null;
    for (const [rid, r] of Object.entries(res)) if (rid.startsWith(sc.id + '-') && (!best || r.t > best.r.t)) best = { id: rid, r };
    return best;
  }
  function screenFor() {
    const t = S.live && S.live.type;
    if (t === 'poll' || t === 'swipe' || t === 'tap' || t === 'end') return t;
    return closedHere() ? 'verdict' : 'idle';
  }
  const winnerOf = (r) => { const c = r.counts || []; const max = Math.max(0, ...c); return max > 0 ? c.indexOf(max) : -1; };
  function renderVerdict() {
    const v = closedHere(); if (!v) return;
    const r = v.r, key = v.id + ':' + (r.counts || []).join(',') + ':' + r.taps;
    if ($('vBars').dataset.key === key) return;
    $('vBars').dataset.key = key;
    if (r.type === 'tap') {
      $('vQ').textContent = r.label || r.q || T('tap.call');
      $('vBars').innerHTML = `<p class="vtap"><b>${NUM(r.taps || 0)}</b><span>${esc(T('phone.roomTaps'))}</span></p>`;
      const m = tapsBy[v.id] || 0;
      $('vYou').textContent = m ? T('phone.youTapped', { n: NUM(m), p: Math.max(1, Math.round((m / Math.max(1, r.taps)) * 1000) / 10) }) : '';
      return;
    }
    const opts = r.options || [], c = r.counts || [], tot = c.reduce((a, b) => a + b, 0), win = winnerOf(r);
    $('vQ').textContent = r.q || '';
    const colour = (i) => (r.type === 'swipe' ? (i ? 'var(--sop-c4)' : 'var(--sop-c3)') : COLORS[i % 6]);
    $('vBars').innerHTML = opts.map((o, i) => {
      const pc = tot ? Math.round((c[i] / tot) * 100) : 0;
      return `<div class="vb${i === win ? ' win' : ''}${mine[v.id] === i ? ' me' : ''}" style="--c:${colour(i)};--w:${pc}%"><span class="vb__l">${esc(o)}</span><span class="vb__t"><i></i></span><b>${pc}%</b></div>`;
    }).join('');
    const my = mine[v.id];
    $('vYou').textContent = my == null ? T('phone.noVote') : my === win ? T('phone.withRoom', { x: opts[my] || '' }) : T('phone.againstRoom', { x: opts[my] || '' });
  }
  function renderNight() {
    const res = S.results || {}, rows = [];
    for (const [rid, r] of Object.entries(res).sort((a, b) => a[1].t - b[1].t)) {
      if (r.type === 'tap') { if (tapsBy[rid]) rows.push([r.label || r.q || T('tap.call'), `${NUM(tapsBy[rid])} ${T('taps')}`]); continue; }
      if (mine[rid] == null) continue;
      rows.push([r.q || '', (r.options || [])[mine[rid]] || '']);
    }
    $('night').innerHTML = rows.length ? `<p class="soft">${esc(T('phone.night'))}</p><ul>${rows.map(([q, a]) => `<li><span>${esc(q)}</span><b>${esc(a)}</b></li>`).join('')}</ul>` : '';
  }
  function render() {
    const scr = screenFor();
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === `s-${scr}`);
    for (const el of document.querySelectorAll('[data-players]')) el.textContent = NUM(S.players);
    $('idleNow').textContent = (S.scene && S.scene.title) || CFG.title || '';
    const L = S.live || {};
    if (L.id !== lastLive) { if (L.type === 'tap') myTaps = tapsBy[L.id] || 0; lastLive = L.id; }
    if (scr === 'verdict') renderVerdict();
    if (scr === 'end') renderNight();
    const v = mine[L.id];
    if (scr === 'poll') {
      $('pollQ').textContent = L.q || '';
      const key = L.id + '|' + (L.options || []).join('|');
      if ($('pollOpts').dataset.key !== key) {
        $('pollOpts').dataset.key = key;
        $('pollOpts').innerHTML = (L.options || []).map((o, i) => `<button class="opt" data-c="${i}" style="--c:${COLORS[i % 6]}">${esc(o)}</button>`).join('');
        for (const b of $('pollOpts').children) b.onclick = (e) => {
          const r = b.getBoundingClientRect(), d = document.createElement('span');
          d.className = 'ripple'; d.style.left = `${e.clientX - r.left}px`; d.style.top = `${e.clientY - r.top}px`;
          b.appendChild(d); setTimeout(() => d.remove(), 650);
          vote(Number(b.dataset.c));
        };
      }
      for (const b of $('pollOpts').children) b.classList.toggle('on', Number(b.dataset.c) === v);
      $('pollMsg').textContent = v != null ? T('phone.voted') : '';
    }
    if (scr === 'swipe') {
      const [l, r] = L.options || ['←', '→'];
      $('swipeQ').textContent = L.q || '';
      $('labL').textContent = l; $('labR').textContent = r;
      $('btnL').textContent = '← ' + l; $('btnR').textContent = r + ' →';
      $('btnL').classList.toggle('on', v === 0); $('btnR').classList.toggle('on', v === 1);
      if (!dragging) {
        $('pcard').style.transform = v === 0 ? 'translateX(-16px) rotate(-5deg)' : v === 1 ? 'translateX(16px) rotate(5deg)' : '';
        $('labL').style.opacity = v === 0 ? 1 : 0; $('labR').style.opacity = v === 1 ? 1 : 0;
      }
      $('swipeMsg').textContent = v != null ? T('phone.voted') : '';
    }
    if (scr === 'tap') {
      $('tapLabel').textContent = L.label || L.q || '';
      $('roomTaps').textContent = NUM(S.taps);
      $('myTaps').textContent = NUM(myTaps);
    }
    if (scr !== lastType) { if (lastType) buzz(60); lastType = scr; }
    $('offline').classList.toggle('on', fails > 2);
    $('dot').classList.toggle('on', fails === 0);
  }

  // joinedEpoch: the room's reset counter we are registered in. A reset (or a failed first try) means join again.
  let joinedEpoch = null, joining = false;
  async function join() {
    if (joining) return; joining = true;
    try {
      const r = await post('join', {});
      if (r && r.you) { joinedEpoch = r.epoch; S = r; $('me').textContent = String(r.you); render(); }
    } finally { joining = false; }
  }
  async function poll() {
    try {
      const r = await fetch(`${API}/state`, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const n = await r.json();
      if (joinedEpoch !== null && n.epoch !== joinedEpoch) { mine = {}; myTaps = 0; for (const k in tapsBy) delete tapsBy[k]; keep(); joinedEpoch = null; }
      if (joinedEpoch === null) join();
      S = n; fails = 0;
    } catch { fails += 1; }
    render();
  }
  async function vote(c) {
    const L = S.live || {};
    if (L.type !== 'poll' && L.type !== 'swipe') return;
    mine[L.id] = c; keep(); render(); buzz(25);
    const r = await post('vote', { live: L.id, choice: c });
    if (r && r.live) { S = { ...S, ...r }; render(); }
  }
  $('btnL').onclick = () => vote(0);
  $('btnR').onclick = () => vote(1);

  // swipe card drag
  let dragging = false, sx = 0, dx = 0;
  const card = $('pcard');
  card.addEventListener('pointerdown', (e) => { dragging = true; sx = e.clientX; dx = 0; card.style.transition = 'none'; card.setPointerCapture(e.pointerId); });
  card.addEventListener('pointermove', (e) => { if (!dragging) return; dx = e.clientX - sx; card.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`; $('labL').style.opacity = Math.max(0, -dx / 90); $('labR').style.opacity = Math.max(0, dx / 90); });
  const end = () => { if (!dragging) return; dragging = false; card.style.transition = ''; if (Math.abs(dx) > 70) vote(dx < 0 ? 0 : 1); else render(); };
  card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);

  // tapping: count locally, send a batch once a second
  const zone = $('tapzone');
  zone.addEventListener('pointerdown', (e) => {
    if ((S.live || {}).type !== 'tap') return;
    myTaps++; pending++; tapsBy[S.live.id] = myTaps; $('myTaps').textContent = NUM(myTaps); buzz(8);
    zone.classList.add('hit'); setTimeout(() => zone.classList.remove('hit'), 70);
    const f = document.createElement('span'); f.className = 'float'; f.textContent = '+1';
    const r = zone.getBoundingClientRect(); f.style.left = `${e.clientX - r.left - 10}px`; f.style.top = `${e.clientY - r.top - 20}px`;
    zone.appendChild(f); setTimeout(() => f.remove(), 800);
    const w = document.createElement('span'); w.className = 'wave'; zone.appendChild(w); setTimeout(() => w.remove(), 720);
  });
  setInterval(async () => {
    if (pending > 0 && (S.live || {}).type === 'tap') {
      const n = pending; pending = 0;
      keep();
      const r = await post('tap', { n });
      if (r && typeof r.taps === 'number') { S.taps = r.taps; render(); }
    }
  }, 1000);

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
  join();
  // 2 s keeps 200 phones at ~100 requests/s; hidden tabs stay quiet (daily request quota on free plans).
  setInterval(() => { if (!document.hidden) poll(); }, 2000);
  render();
})();
