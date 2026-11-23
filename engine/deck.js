// Show of Phones · deck engine.
// Slides are plain <section class="slide" data-id="..."> elements. Elements with data-step="n" appear on step n.
// Live widgets (.sop-join, .sop-poll, .sop-swipe, .sop-tap, .sop-results) talk to the audience's phones.
// A talk may add its own effects with SOP.on('slideId', { enter, step, leave, reset }) in talk.js.
(function () {
  'use strict';
  const T = window.SOP_T, NUM = window.SOP_NUM;
  const CFG = window.SOP_TALK || {};
  const SLUG = CFG.slug || 'talk';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const params = new URLSearchParams(location.search);
  const hooks = {};
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  // Public API for talk.js (runs before the deck starts, because both scripts are deferred).
  const SOP = (window.SOP = {
    on(id, h) { hooks[id] = { ...(hooks[id] || {}), ...h }; },
    wait,
    sfx: (n, v) => sfx(n, v),
    music: (src, v) => music(src, v),
    get live() { return LIVE.state; },
    // where the deck is right now (set once the deck has started)
    get step() { return DECK ? DECK.step : 0; },
    get slide() { return DECK ? DECK.id : null; },
    countUp, typeText, confetti,
  });

  function start() {
    document.body.classList.add('sop-deck');
    const stage = $('#stage');
    const fx = $('#fx');
    const slides = $$('.slide', stage);
    if (!slides.length) { stage.innerHTML = '<p style="padding:40px">No slides.</p>'; return; }

    /* ---------------- slides → frames, notes, steps ---------------- */
    // Backgrounds (.bg) fill the whole window at any aspect ratio. Content goes into a .frame that is
    // 1920×1080 (landscape) or 1080×1920 (portrait: phones, upright tablets), scaled to fit and centred.
    const H = {};
    slides.forEach((s, i) => {
      if (!s.dataset.id) s.dataset.id = `s${i + 1}`;
      const notesEl = $('aside.notes', s);
      const notes = notesEl ? notesEl.textContent.replace(/^\n+|\s+$/g, '').replace(/^[ \t]+/gm, '') : '';
      notesEl?.remove();
      const frame = document.createElement('div');
      frame.className = 'frame';
      for (const child of [...s.children]) if (!child.classList.contains('bg')) frame.appendChild(child);
      s.appendChild(frame);
      // Live widgets get an id (for their votes) and become live-only.
      let k = 0;
      for (const w of $$('.sop-poll, .sop-swipe, .sop-tap', s)) {
        w.classList.add('sop-live');
        if (!w.dataset.live) w.dataset.live = `${s.dataset.id}-${++k}`;
      }
      for (const w of $$('.sop-join, .sop-results', s)) w.classList.add('sop-live');
      let steps = 0;
      for (const x of $$('[data-step]', s)) steps = Math.max(steps, Number(x.dataset.step) || 0);
      for (const x of $$('[data-close]', s)) steps = Math.max(steps, Number(x.dataset.close) || 0);
      const title = s.dataset.title || ($('h1, h2, h3', s)?.textContent || '').trim().slice(0, 80) || s.dataset.id;
      H[s.dataset.id] = { title, notes, steps, transition: s.dataset.transition || 'fade', music: s.dataset.music || null, el: s };
    });
    const order = slides.map((s) => s.dataset.id);

    const view = { w: 1920, h: 1080, portrait: false };
    function fit() {
      const vw = innerWidth, vh = innerHeight;
      const portrait = vh > vw;
      const fw = portrait ? 1080 : 1920, fh = portrait ? 1920 : 1080;
      const sc = Math.min(vw / fw, vh / fh);
      view.w = Math.round(vw / sc); view.h = Math.round(vh / sc); view.portrait = portrait;
      document.body.classList.toggle('portrait', portrait);
      document.documentElement.style.setProperty('--fw', `${fw}px`);
      document.documentElement.style.setProperty('--fh', `${fh}px`);
      for (const el of [stage, fx]) {
        el.style.width = `${view.w}px`;
        el.style.height = `${view.h}px`;
        el.style.transform = `scale(${sc})`;
      }
    }
    addEventListener('resize', fit);
    addEventListener('orientationchange', () => setTimeout(fit, 250));
    fit();

    /* ---------------- live layer ---------------- */
    const KEY_ROOM = `sop-key-${SLUG}`;
    const urlKey = params.get('key') || '';
    if (urlKey) store.set('sop-key', urlKey);
    let KEY = urlKey || store.get(KEY_ROOM) || store.get('sop-key') || '';
    const WANT_PAIR = params.has('pair');
    if (urlKey || WANT_PAIR) history.replaceState(null, '', location.pathname);
    const online = location.protocol.startsWith('http');
    LIVE.ok = online && !!KEY && params.get('live') !== '0';
    const API = `/api/${SLUG}`;
    const joinUrl = online ? `${location.origin}/${SLUG}/play/` : '';
    const post = (path, body) => fetch(`${API}/${path}`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    function setOfflineUI() {
      for (const el of $$('.sop-live')) el.classList.toggle('offline', !LIVE.ok);
    }
    setOfflineUI();

    // What the room should be doing right now, read from the widgets of the current slide and step.
    function liveFor(idx, step) {
      const el = slides[idx];
      let pick = null;
      for (const w of $$('.sop-poll, .sop-swipe, .sop-tap', el)) {
        const from = Number(w.dataset.step || 0), close = w.dataset.close != null ? Number(w.dataset.close) : Infinity;
        if (step >= from && step < close) pick = w;
      }
      if (!pick) return $('.sop-results', el) || el.dataset.phone === 'end' ? { type: 'end' } : { type: 'none' };
      const type = pick.classList.contains('sop-poll') ? 'poll' : pick.classList.contains('sop-swipe') ? 'swipe' : 'tap';
      return { type, id: pick.dataset.live, q: pick.dataset.q || '', label: pick.dataset.label || '', options: (pick.dataset.options || '').split('|').map((x) => x.trim()).filter(Boolean) };
    }

    // One request does three jobs: reports where the deck is (for the phone remote) together with the
    // interaction that should be open, fetches the audience state, and picks up queued remote commands.
    let cmdSeq = null, polling = false;
    async function poll() {
      if (!LIVE.ok || polling) return;
      polling = true;
      try {
        const r = await post('admin', { key: KEY, action: 'deck', deck: deckState(), live: liveFor(state.idx, state.step), since: cmdSeq ?? -1 });
        if (r.status === 403) {
          LIVE.ok = false; setOfflineUI();
          if (store.get(KEY_ROOM) === KEY) store.set(KEY_ROOM, null);
          console.warn('[sop] live: key not accepted');
          return;
        }
        if (!r.ok) throw new Error(r.status);
        const s = await r.json();
        // First contact: skip whatever was queued before this window opened.
        if (cmdSeq !== null) for (const c of s.cmds || []) if (s.t - c.t < 8000) runCmd(c);
        // Server restarted (deploy) → its counter starts over; the 8 s age check keeps old commands from replaying.
        cmdSeq = cmdSeq !== null && s.seq < cmdSeq ? 0 : s.seq;
        delete s.cmds; delete s.seq;
        LIVE.state = s; LIVE.fails = 0;
        renderLive(s);
      } catch { LIVE.fails += 1; } finally { polling = false; }
    }
    setInterval(poll, 900);

    /* ---------------- pairing (venue screen ← phone remote) ---------------- */
    const pairEl = $('#pair');
    $('#pairTag').textContent = T('pair.tag');
    $('#pairTitle').textContent = T('pair.title');
    $('#pairHow').innerHTML = T('pair.how');
    $('#pairAltSum').textContent = T('pair.alt');
    $('#pairKey').placeholder = T('pair.keyPh');
    $('#pairKeyGo').textContent = T('pair.go');
    $('#pairClose').textContent = T('pair.close');
    let pairTimer = null, pairId = null;
    function goLive(key, perRoom) {
      KEY = key;
      store.set(perRoom ? KEY_ROOM : 'sop-key', key);
      LIVE.ok = true; cmdSeq = null;
      setOfflineUI();
      show(state.idx, state.step, { instant: true });
      poll();
    }
    async function newPairCode() {
      const st = $('#pairStatus'), code = $('#pairCode');
      code.classList.remove('ok'); code.textContent = '······'; st.textContent = T('pair.getting');
      try {
        const d = await (await post('pair', { action: 'new' })).json();
        if (!d.code) throw new Error('nocode');
        pairId = d.id;
        code.textContent = `${d.code.slice(0, 3)} ${d.code.slice(3)}`;
        st.textContent = T('pair.waiting');
      } catch { st.textContent = T('pair.noserver'); pairId = null; }
    }
    async function checkPair() {
      if (!pairId) { await newPairCode(); return; }
      try {
        const d = await (await post('pair', { action: 'check', id: pairId })).json();
        if (d.status === 'expired') { pairId = null; await newPairCode(); }
        else if (d.status === 'ok' && d.token) pairDone(d.token, true);
      } catch {}
    }
    function pairDone(key, perRoom) {
      clearInterval(pairTimer); pairTimer = null; pairId = null;
      const code = $('#pairCode');
      pairEl.classList.add('ok');
      code.classList.add('ok'); code.textContent = T('pair.ok');
      $('#pairStatus').textContent = T('pair.okStatus');
      sfx('win', 0.5);
      goLive(key, perRoom);
      setTimeout(closePair, 1400);
    }
    function openPair() {
      if (!online) return;
      pairEl.hidden = false; pairEl.classList.remove('ok');
      newPairCode();
      clearInterval(pairTimer);
      pairTimer = setInterval(checkPair, 1000);
    }
    function closePair() { pairEl.hidden = true; clearInterval(pairTimer); pairTimer = null; pairId = null; }
    $('#pairClose').addEventListener('click', closePair);
    $('#pairKeyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = $('#pairKey').value.trim();
      if (!v) return;
      try {
        const r = await post('admin', { key: v, action: 'peek' });
        if (r.ok) { $('#pairKey').value = ''; pairDone(v, false); } else $('#pairStatus').textContent = T('pair.badKey');
      } catch { $('#pairStatus').textContent = T('pair.noserver'); }
    });
    if (WANT_PAIR) openPair();

    /* ---------------- widgets ---------------- */
    const COLORS = ['var(--sop-c1)', 'var(--sop-c2)', 'var(--sop-c3)', 'var(--sop-c4)', 'var(--sop-c5)', 'var(--sop-c6)'];
    const SEATS = 168; // 6 rows of 28 in the lobby's house
    function buildWidgets() {
      for (const w of $$('.sop-join')) {
        const box = document.createElement('div');
        box.className = 'sop-join__box';
        box.innerHTML = `<div class="sop-join__qr"></div><div class="sop-join__txt"><p class="sop-join__lead">${esc(w.dataset.lead || T('join.lead'))}</p><p class="sop-join__scan">${esc(T('join.scan'))}</p><p class="sop-join__url">${esc(joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</p><p class="sop-join__count"><b data-sop="players">0</b> <span>${esc(T('join.players'))}</span></p></div><div class="sop-join__dots" aria-hidden="true">${'<i></i>'.repeat(SEATS)}</div>`;
        w.appendChild(box);
        if (joinUrl && window.qrcode) {
          const q = window.qrcode(0, 'M'); q.addData(joinUrl); q.make();
          $('.sop-join__qr', box).innerHTML = q.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
        }
      }
      for (const w of $$('.sop-poll')) {
        const opts = (w.dataset.options || 'A|B').split('|').map((x) => x.trim()).filter(Boolean);
        // The question is shown inside the widget only when the slide has no heading of its own.
        const slideHasTitle = [...w.closest('.slide').querySelectorAll('h1, h2, h3')].some((h) => !w.contains(h));
        w.innerHTML = `${w.dataset.q && !slideHasTitle ? `<p class="sop-q">${esc(w.dataset.q)}</p>` : ''}<ul class="sop-bars">${opts.map((o, i) => `<li style="--c:${COLORS[i % 6]}"><span class="sop-bars__l">${esc(o)}</span><span class="sop-bars__track"><i></i></span><b><span class="n">0</span><small>–</small></b></li>`).join('')}</ul><p class="sop-total"><b data-total>0</b> ${esc(T('votes'))}</p>`;
      }
      for (const w of $$('.sop-swipe')) {
        const [l, r] = (w.dataset.options || '←|→').split('|').map((x) => x.trim());
        w.innerHTML = `<div class="sop-card"><span class="sop-card__l">← ${esc(l || '')}</span><p>${esc(w.dataset.q || '')}</p><span class="sop-card__r">${esc(r || '')} →</span></div><p class="sop-swipe__score"><span data-side="0">0</span><span><b data-total>0</b> ${esc(T('votes'))}</span><span data-side="1">0</span></p><p class="sop-swipe__win"></p>`;
      }
      for (const w of $$('.sop-tap')) {
        w.innerHTML = `<p class="sop-tap__call">${esc(w.dataset.label || T('tap.call'))}</p><p class="sop-tap__n"><b data-taps>0</b><span>${esc(T('taps'))}</span></p><div class="sop-tap__burst"></div>`;
      }
    }
    buildWidgets();

    function countsFor(id, s) {
      if (!s) return null;
      if (s.live && s.live.id === id) return { counts: s.counts, taps: s.taps };
      const r = s.results && s.results[id];
      return r ? { counts: r.counts || [], taps: r.taps || 0 } : null;
    }
    let seenPlayers = 0, lastTaps = {};
    // seat order: front row (the last row on screen) first, middle seats first
    const SEAT_ORDER = (() => {
      const cols = 28, rows = SEATS / cols, out = [];
      for (let r = 0; r < rows; r++) {
        const mid = (cols - 1) / 2;
        const row = Array.from({ length: cols }, (_, c) => c).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
        for (const c of row) out.push((rows - 1 - r) * cols + c); // DOM rows run back to front
      }
      return out;
    })();
    function renderLive(s) {
      for (const el of $$('[data-sop=players]')) { if (s.players > (Number(el.dataset.prev) || 0) && el.dataset.prev != null) bump(el); el.dataset.prev = s.players; el.textContent = NUM(s.players); }
      // seats fill front row first, from the middle out, like a real house
      for (const dots of $$('.sop-join__dots')) {
        const seats = dots.children, lit = Math.min(s.players, seats.length);
        for (let k = 0; k < seats.length; k++) {
          const seat = seats[SEAT_ORDER[k]];
          if (k < lit && !seat.classList.contains('on')) { seat.classList.add('on'); seat.style.setProperty('--c', COLORS[k % 6]); }
          else if (k >= lit && seat.classList.contains('on')) seat.classList.remove('on');
        }
        dots.classList.toggle('full', s.players > seats.length);
      }
      if (s.players > seenPlayers && seenPlayers > 0 && $('.sop-join', slides[state.idx])) sfx('join', 0.35);
      seenPlayers = s.players;
      for (const w of $$('.sop-poll')) {
        const c = countsFor(w.dataset.live, s); if (!c) continue;
        const tot = c.counts.reduce((a, b) => a + b, 0), max = Math.max(0, ...c.counts);
        $$('li', w).forEach((li, i) => {
          const v = c.counts[i] || 0;
          if (v > (Number(li.dataset.prev) || 0)) bump(li);
          li.dataset.prev = v;
          $('.n', li).textContent = NUM(v);
          $('small', li).textContent = tot ? `${Math.round((v / tot) * 100)}%` : '–';
          li.style.setProperty('--w', `${snap(li, tot ? v / tot : 0) * 100}%`);
          li.classList.toggle('lead', tot > 0 && v === max);
        });
        $('[data-total]', w).textContent = NUM(tot);
      }
      for (const w of $$('.sop-swipe')) {
        const c = countsFor(w.dataset.live, s); if (!c) continue;
        const [a = 0, b = 0] = c.counts, tot = a + b;
        tilt(w, tot ? (b - a) / tot : 0);
        $('[data-side="0"]', w).textContent = NUM(a); $('[data-side="1"]', w).textContent = NUM(b);
        $('[data-total]', w).textContent = NUM(tot);
      }
      for (const w of $$('.sop-tap')) {
        const c = countsFor(w.dataset.live, s); if (!c) continue;
        if (c.taps > (Number(w.dataset.prev) || 0)) bump($('[data-taps]', w));
        w.dataset.prev = c.taps;
        $('[data-taps]', w).textContent = NUM(c.taps);
        const prev = lastTaps[w.dataset.live];
        if (prev != null && c.taps > prev && w.closest('.slide') === slides[state.idx]) burst(w, c.taps - prev);
        lastTaps[w.dataset.live] = c.taps;
      }
      for (const w of $$('.sop-results')) renderResults(w, s);
      for (const fn of liveListeners) try { fn(s); } catch (e) { console.error(e); }
    }

    // Round a share to whole cells of the bar (no half-lit phone at the end). Plain bars keep the exact value.
    function snap(li, share) {
      const track = li.querySelector('.sop-bars__track');
      const cell = parseFloat(getComputedStyle(track).getPropertyValue('--sop-bar-cell')) || 0;
      const fill = track.firstElementChild, cs = getComputedStyle(fill);
      const mask = cs.maskImage || cs.webkitMaskImage || 'none';
      const width = track.offsetWidth;
      if (!cell || mask === 'none' || !width) return share;
      // light whole cells only: n cells cover n * cell px of the track
      const lit = Math.round(share * Math.floor(width / cell));
      return Math.min(1, (lit * cell) / width);
    }
    // restart a one-shot CSS animation (a light sweep, a number bump)
    function bump(el, cls = 'bump') { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
    function tilt(w, k) {
      const card = $('.sop-card', w);
      card.style.setProperty('--tilt', `${k * 10}deg`);
      card.style.setProperty('--shift', `${k * 90}px`);
      card.style.setProperty('--opl', k < 0 ? Math.min(1, -k * 1.6) : 0);
      card.style.setProperty('--opr', k > 0 ? Math.min(1, k * 1.6) : 0);
    }
    function burst(w, n) {
      const layer = $('.sop-tap__burst', w);
      for (let i = 0; i < Math.min(n, 14); i++) {
        const sp = document.createElement('span');
        sp.textContent = '+' + Math.max(1, Math.round(n / Math.min(n, 14)));
        sp.style.left = `${10 + Math.random() * 80}%`; sp.style.top = `${15 + Math.random() * 60}%`;
        layer.appendChild(sp);
        setTimeout(() => sp.remove(), 1100);
      }
      sfx(n > 25 ? 'up' : 'tap', 0.35);
    }
    function renderResults(w, s) {
      const order = $$('.sop-poll, .sop-swipe, .sop-tap').map((x) => x.dataset.live);
      const rows = [`<li class="sop-res__big"><b>${NUM(s.players)}</b><span>${esc(T('results.players'))}</span></li>`];
      for (const id of order) {
        const def = $(`[data-live="${cssEsc(id)}"]`); const c = countsFor(id, s);
        if (!def || !c) continue;
        if (def.classList.contains('sop-tap')) { rows.push(`<li><span>${esc(def.dataset.label || T('tap.call'))}</span><b>${NUM(c.taps)} ${esc(T('taps'))}</b></li>`); continue; }
        const opts = (def.dataset.options || '').split('|').map((x) => x.trim());
        const tot = c.counts.reduce((a, b) => a + b, 0);
        if (!tot) continue;
        const best = c.counts.indexOf(Math.max(...c.counts));
        rows.push(`<li><span>${esc(def.dataset.q || '')}</span><b>${esc(opts[best] || '')} <small>${Math.round((c.counts[best] / tot) * 100)}%</small></b></li>`);
      }
      const html = (rows.length > 1 || s.players ? rows : [`<li><span>${esc(T('results.empty'))}</span></li>`]).map((r, i) => r.replace('<li', `<li style="--i:${i}"`)).join('');
      const ul = $('ul', w) || w.appendChild(document.createElement('ul'));
      if (ul.innerHTML !== html) ul.innerHTML = html;
    }
    // A widget whose interaction has closed shows the winner.
    function decide(el, step) {
      for (const w of $$('.sop-poll, .sop-swipe', el)) {
        const closed = w.dataset.close != null && step >= Number(w.dataset.close);
        w.classList.toggle('closed', closed);
        if (!closed) { $$('li', w).forEach((li) => li.classList.remove('win')); w.classList.remove('went-l', 'went-r'); continue; }
        const c = countsFor(w.dataset.live, LIVE.state) || { counts: [] };
        const max = Math.max(0, ...c.counts);
        if (w.classList.contains('sop-poll')) $$('li', w).forEach((li, i) => li.classList.toggle('win', max > 0 && c.counts[i] === max));
        else {
          const [a = 0, b = 0] = c.counts; w.classList.toggle('went-l', a >= b && a + b > 0); w.classList.toggle('went-r', b > a);
          const opts = (w.dataset.options || '').split('|').map((x) => x.trim());
          const win = $('.sop-swipe__win', w); if (win) win.textContent = a + b ? opts[b > a ? 1 : 0] || '' : '';
        }
      }
    }

    /* ---------------- transitions ---------------- */
    const grid = document.createElement('div'); grid.className = 'fx__pixel';
    for (let i = 0; i < 24 * 14; i++) { const b = document.createElement('b'); b.style.setProperty('--d', `${Math.random() * 0.45}s`); grid.appendChild(b); }
    const dark = document.createElement('div'); dark.className = 'fx__dark';
    const flash = document.createElement('div'); flash.className = 'fx__flash';
    const curtain = document.createElement('div'); curtain.className = 'fx__curtain'; curtain.innerHTML = '<b></b><b></b>';
    fx.append(grid, dark, flash, curtain);
    async function cover(kind) {
      if (kind === 'pixel') { grid.classList.remove('out'); grid.classList.add('on'); sfx('tap', 0.3); await wait(900); }
      else if (kind === 'dark') { dark.classList.add('on'); await wait(900); }
      else if (kind === 'flash') { flash.classList.add('on'); await wait(110); }
      else if (kind === 'curtain') { curtain.classList.add('on'); await frame2(); curtain.classList.add('shut'); await wait(850); }
    }
    const frame2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    async function uncover(kind) {
      if (kind === 'pixel') { grid.classList.add('out'); await wait(950); grid.classList.remove('on', 'out'); }
      else if (kind === 'dark') { await wait(200); dark.classList.remove('on'); await wait(300); }
      else if (kind === 'flash') flash.classList.remove('on');
      else if (kind === 'curtain') { await wait(150); curtain.classList.remove('shut'); await wait(850); curtain.classList.remove('on'); }
    }

    /* ---------------- engine ---------------- */
    const state = { idx: 0, step: 0, busy: false, queued: 0, get id() { return order[this.idx]; } };
    DECK = state;
    SOP._state = state;
    const current = () => ({ id: order[state.idx], el: slides[state.idx], h: H[order[state.idx]], u: hooks[order[state.idx]] || {} });
    function drain() { if (state.queued > 0) { state.queued -= 1; setTimeout(next, 30); } }
    function reveal(el, n) { for (const x of $$('[data-step]', el)) x.classList.toggle('in', Number(x.dataset.step) <= n); }
    // A step whose only content is a live widget is skipped when the live layer is off.
    function skipOffline(el, n) {
      const items = $$('[data-step]', el).filter((x) => Number(x.dataset.step) === n);
      return items.length > 0 && items.every((x) => x.classList.contains('offline'));
    }
    function call(fn, ...a) { try { return fn?.(...a); } catch (e) { console.error('[sop] talk.js', e); } }

    function show(idx, step, { instant = false } = {}) {
      if (instant && step > 0) quietUntil = performance.now() + 1200;
      slides.forEach((s, i) => {
        if (i !== idx && s.classList.contains('on')) { s.classList.remove('on'); call(hooks[order[i]]?.reset, s); for (const x of $$('[data-step]', s)) x.classList.remove('in'); }
      });
      state.idx = idx; state.step = step;
      const { el, h, u } = current();
      if (instant) el.classList.add('instant');
      call(u.reset, el);
      el.classList.add('on');
      reveal(el, step);
      decide(el, step);
      call(u.enter, el, SOP);
      if (instant) { for (let n = 1; n <= step; n++) call(u.step, el, n, SOP); requestAnimationFrame(() => el.classList.remove('instant')); }
      music(h.music);
      if (LIVE.state) renderLive(LIVE.state);
      broadcast(); poll();
    }
    async function next() {
      if (state.busy) { state.queued = Math.min(state.queued + 1, 2); return; }
      const { el, h, u } = current();
      if (state.step < h.steps) {
        let n = state.step + 1;
        while (n < h.steps && skipOffline(el, n)) n++;
        state.step = n;
        reveal(el, n); decide(el, n);
        sfx('step', 0.25);
        broadcast(); poll();
        state.busy = true;
        try { await Promise.race([call(u.step, el, n, SOP), wait(400)]); } finally { state.busy = false; drain(); }
        return;
      }
      if (state.idx >= slides.length - 1) return;
      await goTo(state.idx + 1, 1);
    }
    async function goTo(idx, dir) {
      if (state.busy) return;
      state.busy = true;
      try {
        const { el, u } = current();
        if (dir > 0) await Promise.race([call(u.leave, el, dir, SOP), wait(3000)]);
        const kind = dir > 0 ? H[order[idx]].transition : 'fade';
        if (kind !== 'fade') await cover(kind);
        show(idx, 0, { instant: kind !== 'fade' });
        if (kind !== 'fade') await uncover(kind);
      } finally { state.busy = false; drain(); }
    }
    function prev() {
      state.queued = 0;
      if (state.busy) return;
      if (state.step > 0) { show(state.idx, state.step - 1, { instant: true }); return; }
      if (state.idx > 0) { const i = state.idx - 1; show(i, H[order[i]].steps, { instant: true }); }
    }

    /* ---------------- presenter sync ---------------- */
    const bc = 'BroadcastChannel' in window ? new BroadcastChannel(`sop-${SLUG}`) : null;
    let startedAt = null;
    function deckState() {
      const { id, h } = current();
      const nx = H[order[state.idx + 1]];
      if (state.idx > 0 && !startedAt) startedAt = Date.now();
      return { idx: state.idx, total: slides.length, id, title: h.title, step: state.step, steps: h.steps, notes: h.notes, next: nx ? nx.title : '—', startedAt, black: $('#blackout').classList.contains('on'), titles: order.map((k) => H[k].title) };
    }
    function broadcast() { bc?.postMessage({ type: 'state', ...deckState(), live: LIVE.ok, liveState: LIVE.state }); }
    function runCmd(m) {
      unlockAudio(); hideHint();
      if (m.cmd === 'next') next();
      else if (m.cmd === 'prev') prev();
      else if (m.cmd === 'goto' && Number.isInteger(m.idx) && m.idx >= 0 && m.idx < slides.length) { state.queued = 0; if (!state.busy) show(m.idx, 0, { instant: true }); }
      else if (m.cmd === 'black') { $('#blackout').classList.toggle('on'); broadcast(); }
      else if (m.cmd === 'reset') newSession();
    }
    // New session: back to the first slide, timer cleared, counters cleared; phones rejoin with fresh numbers.
    async function newSession() {
      state.queued = 0;
      $('#blackout').classList.remove('on');
      startedAt = null;
      try { sessionStorage.removeItem(`sop-pos-${SLUG}`); } catch {}
      LIVE.state = null; seenPlayers = 0; lastTaps = {};
      for (const d of $$('.sop-join__dots')) d.innerHTML = '';
      if (LIVE.ok) { try { await post('admin', { key: KEY, action: 'reset' }); } catch {} }
      const go = () => { if (state.busy) return setTimeout(go, 100); show(0, 0, { instant: true }); };
      go();
    }
    if (bc) {
      bc.onmessage = (e) => { const m = e.data; if (m.type === 'cmd') runCmd(m); if (m.type === 'hello') broadcast(); };
      setInterval(broadcast, 1000);
    }

    /* ---------------- input ---------------- */
    const hint = $('#hint');
    hint.textContent = T('hint');
    function hideHint() { hint.classList.add('gone'); }
    setTimeout(hideHint, 6000);
    function toggleFullscreen() { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {}); }
    addEventListener('keydown', (e) => {
      if (!pairEl.hidden) { if (e.key === 'Escape') closePair(); return; }
      if (e.target.closest('input, textarea, select')) return;
      unlockAudio(); hideHint();
      const k = e.key;
      if (['ArrowRight', ' ', 'PageDown', 'Enter', 'ArrowDown'].includes(k)) { e.preventDefault(); next(); }
      else if (['ArrowLeft', 'PageUp', 'ArrowUp', 'Backspace'].includes(k)) { e.preventDefault(); prev(); }
      else if (k === 'f' || k === 'F') toggleFullscreen();
      else if (k === 'p' || k === 'P') open(`remote/`, `sop-remote-${SLUG}`, 'width=1100,height=780');
      else if (k === 'm' || k === 'M') setMuted(!muted);
      else if (k === 'b' || k === 'B' || k === '.') { $('#blackout').classList.toggle('on'); broadcast(); }
      else if (k === 'Home') show(0, 0);
      else if (k === 'k' || k === 'K') openPair();
    });
    // Pointer: tap = next, horizontal swipe = next/prev.
    let pdown = null;
    stage.addEventListener('pointerdown', (e) => { pdown = { x: e.clientX, y: e.clientY }; if (e.pointerType !== 'mouse') document.body.classList.add('touch'); });
    stage.addEventListener('pointerup', (e) => {
      if (!pdown) return;
      const dx = e.clientX - pdown.x, dy = e.clientY - pdown.y;
      pdown = null;
      unlockAudio(); hideHint();
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) { dx < 0 ? next() : prev(); return; }
      if (Math.abs(dx) > 14 || Math.abs(dy) > 14) return;
      if (e.target.closest('a, button, input, [data-noadvance]')) return;
      next();
    });
    stage.addEventListener('pointercancel', () => { pdown = null; });
    for (const b of $$('#nav button')) b.addEventListener('click', (e) => { e.stopPropagation(); unlockAudio(); b.dataset.a === 'next' ? next() : b.dataset.a === 'prev' ? prev() : toggleFullscreen(); });
    if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
    let curTimer = null;
    addEventListener('mousemove', () => { document.body.classList.add('cursor'); clearTimeout(curTimer); curTimer = setTimeout(() => document.body.classList.remove('cursor'), 1600); });

    /* ---------------- start ---------------- */
    // A reload mid-talk (same tab) resumes where it was instead of jumping back to the first slide.
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(`sop-pos-${SLUG}`) || 'null'); } catch {}
    const resume = !params.get('s') && saved && saved.idx > 0 && saved.idx < slides.length;
    const startAt = resume ? saved.idx : Math.max(0, order.indexOf(params.get('s')));
    const startStep = Math.min(resume ? saved.step : Number(params.get('n')) || 0, H[order[startAt]].steps);
    if (resume && saved.startedAt) startedAt = saved.startedAt;
    show(startAt, startStep, { instant: startStep > 0 });
    setInterval(() => { try { sessionStorage.setItem(`sop-pos-${SLUG}`, JSON.stringify({ idx: state.idx, step: state.step, startedAt })); } catch {} }, 500);
    SOP.next = next; SOP.prev = prev; SOP.goto = (i) => show(i, 0, { instant: true });
  }

  /* ---------------- live state holder ---------------- */
  const LIVE = { ok: false, state: null, fails: 0 };
  let DECK = null;
  const liveListeners = new Set();
  SOP.onLive = (fn) => liveListeners.add(fn);

  /* ---------------- sound ----------------
     No audio files needed: small synthesized blips. A talk can still use its own files via SOP.sfx('path.mp3')
     or data-music="assets/song.mp3" on a slide. */
  let ctx = null, unlocked = false, muted = false, quietUntil = 0;
  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    if (wantMusic) { const m = wantMusic; wantMusic = null; music(m.src, m.vol); }
  }
  const BLIPS = {
    step: [[660, 0.05, 'triangle']],
    tap: [[880, 0.04, 'square']],
    join: [[520, 0.06, 'triangle'], [780, 0.08, 'triangle']],
    up: [[440, 0.07, 'square'], [660, 0.07, 'square'], [990, 0.12, 'square']],
    win: [[523, 0.1, 'triangle'], [659, 0.1, 'triangle'], [784, 0.1, 'triangle'], [1047, 0.25, 'triangle']],
    ding: [[1320, 0.35, 'sine']],
  };
  function sfx(name, vol = 0.6) {
    if (muted || !unlocked || performance.now() < quietUntil) return;
    if (/\.(mp3|m4a|ogg|wav)$/i.test(name)) { const a = new Audio(name); a.volume = vol; a.play().catch(() => {}); return; }
    const seq = BLIPS[name]; if (!seq || !ctx) return;
    let t = ctx.currentTime;
    for (const [f, d, type] of seq) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18 * vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + d + 0.02);
      t += d * 0.9;
    }
  }
  let musicEl = null, musicSrc = null, wantMusic = null;
  function fadeTo(a, target, ms = 1200) {
    // timer-based (not rAF) so fades still finish when the tab is in the background
    const tok = (a._fade = (a._fade || 0) + 1);
    const from = a.volume, t0 = performance.now();
    if (target > 0 && a.paused) a.play().catch(() => {});
    const tick = () => {
      if (a._fade !== tok) return;
      const k = Math.min(1, (performance.now() - t0) / ms);
      a.volume = Math.max(0, Math.min(1, from + (target - from) * k));
      if (k < 1) setTimeout(tick, 30); else if (target === 0) a.pause();
    };
    tick();
  }
  function music(src, vol = 0.3) {
    if (src === musicSrc) return;
    if (musicEl) { const old = musicEl; fadeTo(old, 0, 900); }
    musicSrc = src; musicEl = null;
    if (!src) return;
    if (!unlocked || muted) { wantMusic = { src, vol }; return; }
    const a = new Audio(src); a.loop = true; a.volume = 0; musicEl = a;
    fadeTo(a, vol, 1500);
  }
  function setMuted(m) {
    muted = m;
    if (muted && musicEl) fadeTo(musicEl, 0, 300);
    if (!muted && musicSrc) { const s = musicSrc; musicSrc = null; music(s); }
  }

  /* ---------------- helpers for talks ---------------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'); }
  function countUp(el, to, ms = 1400) {
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ms); el.textContent = NUM(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  async function typeText(el, ms = 32) {
    const text = el.dataset.full || el.textContent;
    el.dataset.full = text; el.textContent = '';
    for (const ch of text) { el.textContent += ch; await wait(ms); }
  }
  function confetti(n = 120) {
    const layer = document.createElement('div'); layer.className = 'sop-confetti';
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.style.left = `${Math.random() * 100}%`; p.style.setProperty('--d', `${0.8 + Math.random() * 1.6}s`);
      p.style.setProperty('--r', `${Math.random() * 720 - 360}deg`); p.style.setProperty('--c', `var(--sop-c${1 + (i % 6)})`);
      layer.appendChild(p);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 3000);
  }

  // Deferred scripts (talk.js) run before DOMContentLoaded, so their SOP.on() hooks are in place when we start.
  if (document.readyState === 'complete') start(); else document.addEventListener('DOMContentLoaded', start);
})();
