// Show of Phones · phone remote. Two ways to reach the deck:
//  · local: the deck runs in another window of this browser → BroadcastChannel, instant.
//  · remote: the deck runs on another device (phone as clicker) → commands go through /api/<talk>/admin.
(function () {
  'use strict';
  const T = window.SOP_T, NUM = window.SOP_NUM;
  const CFG = window.SOP_TALK || {};
  const SLUG = CFG.slug;
  const API = `/api/${SLUG}`;
  const PAIR_URL = `${location.host}/${SLUG}/pair`;
  const DURATION = Math.max(1, Number(CFG.duration) || 10) * 60;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  let KEY = params.get('key') || '';
  if (KEY) store.set('sop-key', KEY); else KEY = store.get('sop-key') || '';
  if (params.get('key')) history.replaceState(null, '', location.pathname);

  // static text
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('h1').textContent = CFG.title || SLUG;
  document.title = `${T('remote.title')}: ${CFG.title || SLUG}`;
  $('ctxt').textContent = T('remote.connecting');
  $('pairToggle').textContent = T('remote.pairBtn');
  $('clockLbl').textContent = `${T('remote.clock')} (${mmss(DURATION)})`;
  $('clock').textContent = mmss(DURATION);
  $('pairTitle').textContent = T('remote.pairTitle');
  $('pairHow').innerHTML = T('remote.pairHow', { url: esc(PAIR_URL) });
  $('pairGo').textContent = T('remote.pairGo');
  $('keyIn').placeholder = T('remote.keyPh');
  $('keyGo').textContent = T('remote.keyGo');
  $('nowLbl').textContent = T('remote.now');
  $('now').textContent = T('remote.waiting');
  $('nextLbl').textContent = T('remote.next');
  $('liveLbl').textContent = T('remote.live');
  $('notesLbl').textContent = T('remote.notes');
  $('prev').textContent = T('remote.prev');
  $('nextBtn').textContent = T('remote.nextBtn');
  $('black').textContent = T('remote.black');
  $('jump').options[0].textContent = T('remote.jump');
  $('reset').textContent = T('remote.reset');

  const bc = 'BroadcastChannel' in window ? new BroadcastChannel(`sop-${SLUG}`) : null;
  let localSeen = 0, remote = null, remoteOk = false, remoteFails = 0, deck = null, live = null, skew = 0, badKey = false;
  const isLocal = () => Date.now() - localSeen < 2500;

  function liveSummary(s) {
    if (!s) return '';
    const parts = [`<span>${esc(T('remote.players'))} <b>${NUM(s.players)}</b></span>`];
    const L = s.live || {};
    if (L.type === 'poll' || L.type === 'swipe') parts.push(...(L.options || []).map((o, i) => `<span>${esc(o)} <b>${NUM((s.counts || [])[i])}</b></span>`));
    if (L.type === 'tap') parts.push(`<span>${esc(T('remote.taps'))} <b>${NUM(s.taps)}</b></span>`);
    return parts.join('');
  }

  function render() {
    const m = deck;
    if (m) {
      $('pos').textContent = `${m.idx + 1} / ${m.total}`;
      $('now').textContent = m.title;
      $('next').textContent = m.next;
      // notes: lines that start with "n ·" belong to step n; the current one is lit
      const lines = String(m.notes || '').split('\n');
      $('notes').innerHTML = lines.map((ln) => { const k = ln.match(/^\s*(\d+)\s*[·.:-]/); const cls = k ? (Number(k[1]) === m.step ? 'cur' : Number(k[1]) < m.step ? 'past' : '') : ''; return `<span class="${cls}">${esc(ln) || '&nbsp;'}</span>`; }).join('');
      $('notes').querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
      $('steps').innerHTML = Array.from({ length: m.steps + 1 }, (_, i) => `<i class="${i <= m.step ? 'on' : ''}"></i>`).join('');
      $('black').classList.toggle('on', !!m.black);
      $('black').textContent = m.black ? T('remote.unblack') : T('remote.black');
      const sel = $('jump');
      if (m.titles && sel.options.length !== m.titles.length + 1) {
        sel.innerHTML = `<option value="">${esc(T('remote.jump'))}</option>` + m.titles.map((t, i) => `<option value="${i}">${i + 1}. ${esc(t)}</option>`).join('');
      }
    }
    $('live').innerHTML = liveSummary(live);
    let txt, cls, alert = '';
    if (isLocal()) { txt = T('remote.local'); cls = 'on'; }
    else if (badKey) { txt = T('remote.badKey'); cls = ''; alert = T('remote.badKeyAlert'); }
    else if (!KEY) { txt = T('remote.noKey'); cls = ''; alert = T('remote.noKeyAlert'); }
    else if (!remoteOk) { txt = remoteFails ? T('remote.noNet') : T('remote.connecting'); cls = remoteFails ? '' : 'mid'; if (remoteFails > 3) alert = T('remote.noNetAlert'); }
    else if (!remote || !remote.deck) { txt = T('remote.noDeck'); cls = 'mid'; alert = T('remote.noDeckAlert', { url: PAIR_URL }); }
    else {
      const age = (remote.t - remote.deck.seen) / 1000;
      if (age > 4) { txt = T('remote.stale', { n: Math.round(age) }); cls = 'mid'; alert = T('remote.staleAlert'); }
      else { txt = T('remote.ok'); cls = 'on'; }
    }
    $('ctxt').textContent = txt;
    $('cdot').className = 'dot ' + cls;
    $('alert').textContent = alert; $('alert').classList.toggle('on', !!alert);
    $('keybox').classList.toggle('on', !isLocal() && (!KEY || badKey));
    const canPair = !isLocal() && !!KEY && !badKey && remoteOk;
    const deckGone = !remote || !remote.deck || remote.t - remote.deck.seen > 4000;
    $('pairToggle').hidden = !canPair;
    $('pairbox').classList.toggle('on', canPair && (pairOpen || (deckGone && !pairDismissed)));
    const can = isLocal() || (remoteOk && !!KEY && !badKey);
    for (const b of document.querySelectorAll('.bar button, .bar select')) b.disabled = !can;
  }

  if (bc) {
    bc.onmessage = (e) => {
      const m = e.data; if (m.type !== 'state') return;
      localSeen = Date.now(); skew = 0;
      deck = m; if (m.liveState) live = m.liveState;
      render();
    };
    bc.postMessage({ type: 'hello' });
  }

  async function admin(body) {
    const r = await fetch(`${API}/admin`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: KEY, ...body }) });
    if (r.status === 403) { badKey = true; render(); throw new Error('key'); }
    if (!r.ok) throw new Error(r.status);
    badKey = false;
    return r.json();
  }
  let peeking = false;
  async function peek() {
    if (isLocal() || !KEY || badKey || peeking || !location.protocol.startsWith('http')) return;
    peeking = true;
    try {
      remote = await admin({ action: 'peek' });
      remoteOk = true; remoteFails = 0;
      skew = Date.now() - remote.t;
      live = remote;
      if (remote.deck) deck = remote.deck;
    } catch { remoteOk = false; remoteFails += 1; }
    finally { peeking = false; render(); }
  }
  setInterval(() => { if (!document.hidden) peek(); }, 1200);
  setInterval(render, 1000);
  peek();

  // Pairing a venue screen: it shows a code, we approve it with the admin key.
  let pairOpen = false, pairDismissed = false;
  $('pairToggle').onclick = () => { pairOpen = !$('pairbox').classList.contains('on'); pairDismissed = !pairOpen; render(); if (pairOpen) $('pairIn').focus(); };
  $('pairbox').onsubmit = async (e) => {
    e.preventDefault();
    const code = $('pairIn').value.replace(/\D/g, '');
    const msg = $('pairMsg');
    const say = (cls, t) => { msg.className = 'pairmsg ' + cls; msg.textContent = t; };
    if (code.length !== 6) { say('err', T('remote.pairLen')); return; }
    say('', T('remote.connecting'));
    try {
      const r = await fetch(`${API}/admin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: KEY, action: 'pair', code }) });
      if (r.ok) { say('ok', T('remote.pairOk')); $('pairIn').value = ''; navigator.vibrate?.([20, 40, 20]); setTimeout(() => { pairOpen = false; pairDismissed = true; msg.textContent = ''; render(); }, 4000); }
      else if (r.status === 404) say('err', T('remote.pairNotFound'));
      else if (r.status === 429) say('err', T('remote.pairLocked'));
      else say('err', T('remote.pairFail', { n: r.status }));
    } catch { say('err', T('remote.pairNoNet')); }
  };

  function flash(el) { if (!el) return; el.classList.remove('sent'); void el.offsetWidth; el.classList.add('sent'); navigator.vibrate?.(15); }
  async function cmd(c, extra = {}, el) {
    flash(el);
    if (isLocal()) { bc.postMessage({ type: 'cmd', cmd: c, ...extra }); return; }
    if (!KEY) return;
    try { await admin({ action: 'cmd', cmd: c, ...extra }); setTimeout(peek, 500); }
    catch { remoteOk = false; remoteFails += 1; render(); }
  }
  $('prev').onclick = (e) => cmd('prev', {}, e.currentTarget);
  $('nextBtn').onclick = (e) => cmd('next', {}, e.currentTarget);
  $('black').onclick = (e) => cmd('black', {}, e.currentTarget);
  $('jump').onchange = (e) => { const v = e.target.value; if (v !== '') cmd('goto', { idx: Number(v) }, e.target); e.target.value = ''; };
  $('reset').onclick = (e) => { if (confirm(T('remote.resetAsk'))) cmd('reset', {}, e.currentTarget); };
  $('keyGo').onclick = () => { const v = $('keyIn').value.trim(); if (!v) return; KEY = v; badKey = false; store.set('sop-key', KEY); $('keyIn').value = ''; peek(); };

  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (['ArrowRight', ' ', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); cmd('next', {}, $('nextBtn')); }
    if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); cmd('prev', {}, $('prev')); }
    if (e.key === 'b' || e.key === 'B') cmd('black', {}, $('black'));
  });

  // Keep the phone awake while it is the clicker.
  let lock = null;
  async function wake() { try { if (document.visibilityState === 'visible' && !lock) { lock = await navigator.wakeLock?.request('screen'); lock?.addEventListener('release', () => { lock = null; }); } } catch {} }
  document.addEventListener('visibilitychange', () => { wake(); if (document.visibilityState === 'visible') peek(); });
  addEventListener('pointerdown', wake, { once: true });
  wake();

  setInterval(() => {
    if (!deck || !deck.startedAt) { $('clock').textContent = mmss(DURATION); $('clock').className = 'clock'; return; }
    const left = DURATION - Math.floor((Date.now() - (isLocal() ? 0 : skew) - deck.startedAt) / 1000);
    $('clock').textContent = `${left < 0 ? '+' : ''}${mmss(Math.abs(left))}`;
    $('clock').className = 'clock' + (left < 0 ? ' over' : left < 90 ? ' warn' : '');
  }, 250);
  render();
})();
