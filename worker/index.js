// Show of Phones · live layer.
// Static files (decks, phone pages, remote, landing) come from ./dist. Only /api/* and a few short
// redirects reach this code. Every talk gets its own Durable Object room, named after its folder.

const ROOM_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TYPES = new Set(['none', 'poll', 'swipe', 'tap', 'end']);
const VOTE_TYPES = new Set(['poll', 'swipe']);
const MAX_OPTIONS = 6;
const CMDS = new Set(['next', 'prev', 'black', 'goto', 'reset']);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

// The list of rooms is written by `sop build` (dist/_sop/rooms.json). Unknown rooms are refused,
// so nobody can create storage on your account by inventing room names.
let roomsCache = null;
let roomsAt = 0;
async function knownRooms(env, origin) {
  if (!roomsCache || Date.now() - roomsAt > 60_000) {
    try {
      const r = await env.ASSETS.fetch(new Request(`${origin}/_sop/rooms.json`));
      roomsCache = r.ok ? (await r.json()).rooms || {} : {};
    } catch {
      roomsCache = {};
    }
    roomsAt = Date.now();
  }
  return roomsCache;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    // Short, typeable address for a venue computer: /<talk>/pair (or /<talk>/baglan) opens the deck in pairing mode.
    if (parts.length === 2 && (parts[1] === 'pair' || parts[1] === 'baglan') && ROOM_RE.test(parts[0])) {
      return Response.redirect(`${url.origin}/${parts[0]}/?pair=1`, 302);
    }

    if (parts[0] === 'api') {
      const room = parts[1] || '';
      if (!ROOM_RE.test(room)) return json({ error: 'room' }, 404);
      const rooms = await knownRooms(env, url.origin);
      if (!rooms[room]) return json({ error: 'room' }, 404);
      const stub = env.ROOM.get(env.ROOM.idFromName(room));
      const inner = new Request(`https://room/${parts.slice(2).join('/')}`, request);
      inner.headers.set('x-sop-room', JSON.stringify(rooms[room]));
      return stub.fetch(inner);
    }
    return env.ASSETS.fetch(request);
  },
};

// Clean one interaction definition coming from a deck (or from rooms.json for always-open rooms).
function cleanLive(l) {
  if (!l || typeof l !== 'object' || !TYPES.has(l.type)) return { type: 'none' };
  if (l.type === 'none') return { type: 'none' };
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const out = { type: l.type, id: str(l.id, 60) || l.type, q: str(l.q, 300), label: str(l.label, 120) };
  if (VOTE_TYPES.has(l.type)) {
    const opts = Array.isArray(l.options) ? l.options.map((o) => str(o, 80)).filter(Boolean).slice(0, MAX_OPTIONS) : [];
    out.options = l.type === 'swipe' ? [opts[0] || '←', opts[1] || '→'] : opts.length >= 2 ? opts : ['A', 'B'];
  }
  return out;
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = null;
    this.lastTap = new Map();
    this.dirty = false;
    this.room = {};
    // Remote control: commands from the phone remote and the deck's last reported position (memory only).
    this.cmds = [];
    this.seq = 0;
    this.deck = null;
    // Pairing: a screen without the admin key shows a short code; the phone remote approves it and the
    // screen receives a session token that works like the key (for this room only) for 12 hours.
    this.pairs = new Map(); // id -> { code, exp, token }
    this.pairFails = [];
    this.tokens = null; // token -> expiry, persisted
  }

  fresh() {
    return { live: { type: 'none' }, counts: [], voters: {}, taps: 0, players: {}, nplayers: 0, results: {}, epoch: Date.now(), touched: false };
  }

  async load() {
    if (!this.state) this.state = (await this.ctx.storage.get('state')) || this.fresh();
    // Always-open rooms (e.g. the poll on a landing page) run one interaction until an admin takes over.
    const open = this.room.open && cleanLive(this.room.open);
    if (open && open.type !== 'none' && !this.state.touched && this.state.live.id !== open.id) this.setLive(open);
  }

  save() {
    if (this.dirty) return;
    this.dirty = true;
    // Coalesce bursts of taps and votes into one write.
    this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  async alarm() {
    this.dirty = false;
    await this.ctx.storage.put('state', this.state);
  }

  async loadTokens() {
    if (!this.tokens) this.tokens = (await this.ctx.storage.get('tokens')) || {};
    const now = Date.now();
    for (const [t, exp] of Object.entries(this.tokens)) if (exp < now) delete this.tokens[t];
  }

  async authorized(key) {
    if (typeof key !== 'string' || !key) return false;
    if (this.env.ADMIN_KEY && key === this.env.ADMIN_KEY) return true;
    await this.loadTokens();
    return !!this.tokens[key];
  }

  sweepPairs() {
    const now = Date.now();
    for (const [id, p] of this.pairs) if (p.exp < now) this.pairs.delete(id);
  }

  // Switch the room to another interaction. The finished one is kept in `results`; coming back to an
  // interaction (presenter pressed back) continues its counts instead of wiping the room's votes.
  setLive(next) {
    const s = this.state;
    const cur = s.live;
    if (cur.type === next.type && cur.id === next.id) return false;
    if (VOTE_TYPES.has(cur.type) || cur.type === 'tap') {
      s.results[cur.id] = { type: cur.type, q: cur.q, label: cur.label, options: cur.options, counts: s.counts, taps: s.taps, t: Date.now() };
      const ids = Object.keys(s.results);
      if (ids.length > 30) delete s.results[ids[0]];
    }
    s.live = next;
    const prev = s.results[next.id];
    if (VOTE_TYPES.has(next.type)) {
      s.counts = prev && prev.counts && prev.counts.length === next.options.length ? prev.counts : next.options.map(() => 0);
    }
    if (next.type === 'tap') s.taps = (prev && prev.taps) || 0;
    this.save();
    return true;
  }

  publicState() {
    const s = this.state;
    return {
      live: s.live,
      counts: s.counts,
      taps: s.taps,
      players: s.nplayers,
      results: s.results,
      epoch: s.epoch,
      // Which slide is on the big screen (id, step, title; never notes) so phones can show where we are.
      scene: this.deck && Date.now() - this.deck.seen < 15000 ? { id: String(this.deck.id), step: Number(this.deck.step) || 0, title: String(this.deck.title || '').slice(0, 120) } : null,
      t: Date.now(),
    };
  }

  async fetch(request) {
    try { this.room = JSON.parse(request.headers.get('x-sop-room') || '{}') || {}; } catch { this.room = {}; }
    await this.load();
    const path = new URL(request.url).pathname.slice(1);
    const s = this.state;

    if (request.method === 'GET' && path === 'state') return json(this.publicState());
    if (request.method !== 'POST') return json({ error: 'method' }, 405);

    let body = {};
    try { body = await request.json(); } catch { return json({ error: 'json' }, 400); }
    const id = typeof body.id === 'string' ? body.id.slice(0, 40) : '';

    if (path === 'join') {
      if (!id) return json({ error: 'id' }, 400);
      if (!s.players[id] && s.nplayers < 5000) {
        s.nplayers += 1;
        s.players[id] = s.nplayers;
        this.save();
      }
      return json({ ...this.publicState(), you: s.players[id] || 0 });
    }

    if (path === 'vote') {
      if (!id || !VOTE_TYPES.has(s.live.type) || body.live !== s.live.id) return json(this.publicState());
      const choice = Number(body.choice);
      if (!Number.isInteger(choice) || choice < 0 || choice >= s.counts.length) return json({ error: 'choice' }, 400);
      const key = `${s.live.id}:${id}`;
      const prev = s.voters[key];
      if (prev !== choice) {
        if (Number.isInteger(prev) && prev < s.counts.length) s.counts[prev] = Math.max(0, s.counts[prev] - 1);
        s.counts[choice] += 1;
        s.voters[key] = choice;
        this.save();
      }
      return json({ ...this.publicState(), yours: choice });
    }

    if (path === 'tap') {
      if (!id || s.live.type !== 'tap') return json(this.publicState());
      const now = Date.now();
      const last = this.lastTap.get(id) || 0;
      // Phones send a batch about once a second; at most ~25 taps per second per phone.
      const allowed = Math.min(Math.max(0, Math.floor(body.n) || 0), Math.ceil(((now - last) / 1000) * 25), 60);
      this.lastTap.set(id, now);
      if (this.lastTap.size > 4000) this.lastTap.clear();
      if (allowed > 0) {
        s.taps += allowed;
        this.save();
      }
      return json(this.publicState());
    }

    if (path === 'pair') {
      this.sweepPairs();
      if (body.action === 'new') {
        if (this.pairs.size >= 30) return json({ error: 'busy' }, 429);
        let code;
        do { code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)); } while ([...this.pairs.values()].some((p) => p.code === code));
        const pid = crypto.randomUUID();
        this.pairs.set(pid, { code, exp: Date.now() + 5 * 60 * 1000, token: null });
        return json({ id: pid, code, exp: this.pairs.get(pid).exp });
      }
      if (body.action === 'check') {
        const p = this.pairs.get(String(body.id || ''));
        if (!p) return json({ status: 'expired' });
        if (!p.token) return json({ status: 'wait' });
        this.pairs.delete(String(body.id));
        return json({ status: 'ok', token: p.token });
      }
      return json({ error: 'action' }, 400);
    }

    if (path === 'admin') {
      if (!(await this.authorized(body.key))) return json({ error: 'key' }, 403);
      const realKey = !!this.env.ADMIN_KEY && body.key === this.env.ADMIN_KEY;

      if (body.action === 'pair') {
        // Only the real admin key may approve new screens (a paired screen cannot pair others).
        if (!realKey) return json({ error: 'key' }, 403);
        const now = Date.now();
        this.pairFails = this.pairFails.filter((t) => now - t < 5 * 60 * 1000);
        if (this.pairFails.length >= 10) return json({ error: 'locked' }, 429);
        this.sweepPairs();
        const code = String(body.code || '').replace(/\D/g, '');
        const entry = [...this.pairs.values()].find((p) => p.code === code && !p.token);
        if (!entry) { this.pairFails.push(now); return json({ error: 'code' }, 404); }
        entry.token = 'tk_' + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
        await this.loadTokens();
        this.tokens[entry.token] = now + 12 * 60 * 60 * 1000;
        await this.ctx.storage.put('tokens', this.tokens);
        return json({ ok: true });
      }
      if (body.action === 'revoke') {
        if (!realKey) return json({ error: 'key' }, 403);
        this.tokens = {};
        await this.ctx.storage.put('tokens', this.tokens);
        return json({ ok: true });
      }
      if (body.action === 'cmd') {
        if (!CMDS.has(body.cmd)) return json({ error: 'cmd' }, 400);
        this.seq += 1;
        this.cmds.push({ seq: this.seq, cmd: body.cmd, idx: Number.isInteger(body.idx) ? body.idx : undefined, t: Date.now() });
        if (this.cmds.length > 30) this.cmds.splice(0, this.cmds.length - 30);
        return json({ ok: true, seq: this.seq });
      }
      // The deck's heartbeat: report position, set the current interaction, pick up queued remote commands.
      if (body.action === 'deck') {
        const d = body.deck && typeof body.deck === 'object' ? body.deck : null;
        if (d) this.deck = { ...d, seen: Date.now() };
        if (body.live) { s.touched = true; this.setLive(cleanLive(body.live)); }
        const since = Number(body.since);
        return json({ ...this.publicState(), seq: this.seq, cmds: Number.isFinite(since) ? this.cmds.filter((c) => c.seq > since) : [] });
      }
      if (body.action === 'live') {
        s.touched = true;
        this.setLive(cleanLive(body.live));
        return json(this.publicState());
      }
      if (body.action === 'peek') return json({ ...this.publicState(), seq: this.seq, deck: this.deck });
      if (body.action === 'reset') {
        this.state = this.fresh();
        await this.ctx.storage.delete('state');
        await this.load();
        this.save();
        return json(this.publicState());
      }
      return json({ error: 'action' }, 400);
    }

    return json({ error: 'path' }, 404);
  }
}
