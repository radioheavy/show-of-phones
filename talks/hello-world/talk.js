// Optional effects for this talk. SOP.on(slideId, { enter, step, leave, reset }) and SOP.onLive(state => …).

/* "This room": a giant live count of the phones that joined. */
let shown = -1;
function showCount(el) {
  const n = SOP.live ? SOP.live.players || 0 : null;
  const big = el.querySelector('[data-count]');
  if (n === null) { big.textContent = '—'; return; }   // offline: no live layer
  if (n === shown) return;
  if (shown <= 0) SOP.countUp(big, n); else big.textContent = n;   // count up once, then just follow
  shown = n;
}
SOP.on('room', {
  enter(el) { shown = -1; showCount(el); },
  reset(el) { shown = -1; el.querySelector('[data-count]').textContent = '—'; },
});

/* Poll: once voting closes, write one line from the room's answer. */
const VERDICTS = {
  'Front row': 'Front row wins. No hiding today.',
  'Back row': 'Back row wins. We see you anyway.',
  'At home': 'Most of you are at home. Hello, living rooms!',
  'On stage': 'Most of you claim to be on stage. Bold.',
};
function verdict(el) {
  const r = SOP.live && SOP.live.results && SOP.live.results['poll-1'];
  const p = el.querySelector('[data-verdict]');
  if (!r || !r.counts.some(Boolean)) { p.textContent = 'Nobody voted. Phones are still in pockets.'; return; }
  const top = r.counts.indexOf(Math.max(...r.counts));
  p.textContent = VERDICTS[r.options[top]] || `The room says: ${r.options[top]}.`;
}
SOP.on('poll', { step(el, n) { if (n === 3) verdict(el); } });

/* Tap race: the room charges a battery. A full charge takes about 60 taps per phone in the room,
   so 10 people and 300 people both need a real effort. */
let battery = 0;
function charge(el, taps) {
  const players = (SOP.live && SOP.live.players) || 1;
  const full = Math.max(300, players * 60);
  battery = Math.min(100, Math.round((taps / full) * 100));
  el.querySelector('.battery').style.setProperty('--charge', battery + '%');
  el.querySelector('.battery b').textContent = battery + '%';
}
SOP.on('tap', {
  enter(el) { const r = SOP.live && SOP.live.results && SOP.live.results['tap-1']; charge(el, r ? r.taps : 0); },
  step(el, n) { if (n === 2) { SOP.confetti(160); SOP.sfx('win'); } },
});

SOP.onLive((s) => {
  if (SOP.slide === 'room') showCount(document.querySelector('.slide[data-id="room"]'));
  const el = document.querySelector('.slide[data-id="tap"]');
  const taps = s.live && s.live.id === 'tap-1' ? s.taps : (s.results && s.results['tap-1'] ? s.results['tap-1'].taps : 0);
  charge(el, taps);
});
