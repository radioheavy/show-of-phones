# Talk format

A talk is one folder in `talks/`. The folder name is the talk's address and its live room:
`talks/my-talk/` → `https://your-domain/my-talk/`.

```
talks/my-talk/
  talk.json     # title, language, theme, duration, links
  slides.html   # the slides
  talk.css      # optional: styles for this talk (loaded by the deck, the phones and the remote)
  talk.js       # optional: custom effects
  assets/       # optional: images, video, audio (reference as assets/file.png)
```

Folder names: lowercase letters, digits and dashes, max 40 characters. Folders starting with `_` are ignored (`_template`).

## talk.json

```json
{
  "title": "Hello, room",
  "lang": "en",
  "theme": "arcade",
  "duration": 10,
  "thanks": "Thanks for playing!",
  "links": [{ "label": "My website", "url": "https://example.com" }]
}
```

| key | meaning |
|---|---|
| `title` | shown on phones and the remote |
| `lang` | interface language: `en` or `tr` (add more in `engine/i18n.js`) |
| `theme` | `house` (default, a dark theatre), `daylight` (bright rooms), `arcade` (pixel), or an object that overrides colours, fonts, corners and bar style. Full guide: [THEMES.md](THEMES.md) |
| `duration` | minutes, for the remote's countdown |
| `thanks` | text on the phones at the end |
| `links` | buttons on the phones at the end |

## slides.html

Each slide is a `<section class="slide">`. The slide area is **1920×1080** on landscape screens and
**1080×1920** on portrait screens (phones, upright tablets). It is scaled to fit any window. Use
`body.portrait …` in talk.css when a slide needs a different portrait layout.

```html
<section class="slide" data-id="intro" data-title="Intro" data-transition="pixel">
  <p class="kicker">01 · the idea</p>
  <h2>Every talk starts with “phones away.”</h2>
  <p class="lede" data-step="1">This one doesn’t.</p>
  <aside class="notes">
0 · Say the first line.
1 · The second line appears. Pause.
  </aside>
</section>
```

### Slide attributes

| attribute | meaning |
|---|---|
| `data-id` | unique id (letters, digits, dashes). Used by talk.js and for votes. |
| `data-title` | name on the remote ("next slide", "go to slide"). Defaults to the first heading. |
| `data-transition` | how this slide arrives: `fade` (default), `curtain` (two drapes close and open), `dark`, `flash`, `pixel` |
| `data-music` | a looping track for this slide, e.g. `assets/theme.mp3` (fades between slides) |
| `data-phone="end"` | phones show the thank-you screen on this slide (automatic with `.sop-results`) |

### Steps

Any element with `data-step="n"` appears on the n-th press of "next". Step 0 is what you see when the
slide arrives. The slide moves on once its last step is shown.

### Notes

`<aside class="notes">` is removed from the slide and shown only on the remote. Write one line per
step, starting with the step number (`0 · …`, `1 · …`), in the speaker's own words.

### Ready-made classes

`kicker` (small label), `lede` (big soft paragraph), `huge` (giant number/word), `accent`, `accent2`,
`muted`, `list` (on a `<ul>`), `split` (two columns, stacked in portrait), `card-box` (panel),
`left` (on the section: left-aligned layout). Headings `h1` / `h2` / `h3` are already sized.

A full-bleed background: `<img class="bg" src="assets/photo.jpg">` (also works for `<video class="bg">`).

## Live widgets

Live widgets only show when the deck runs with the live layer (admin key or a paired screen).
Without it they disappear, and a step that contains only a live widget is skipped, so the same deck
works offline.

### Join: `.sop-join`

```html
<div class="sop-join" data-lead="Phones out. You are part of this."></div>
```
QR code, the phone address and a live "people joined" counter. Put it on the first slide.
Under it, a raked house of seats fills up: every phone that joins lights the next seat, front row first.

### Poll: `.sop-poll`

```html
<div class="sop-poll" data-step="1" data-close="2"
     data-q="Where are you right now?" data-options="Front row|Back row|At home|On stage"></div>
```
- 2 to 6 options separated by `|`.
- Voting opens at `data-step` and closes at `data-close` (then the winner lights up). Without
  `data-close` it stays open until the slide changes.
- Phones show the question and the options as big buttons. People can change their vote.
- The question is also printed above the bars when the slide has no heading of its own.

All live widgets (poll, swipe, tap) wait on the slide, dimmed, until their `data-step` opens them, so
the room sees what is coming. When one closes, every phone shows the result ("the room decided")
and how its owner voted, until the slide changes. The last screen on the phones lists each
person's own answers ("your night") above the talk's links.

### Swipe: `.sop-swipe`

```html
<div class="sop-swipe" data-step="1" data-close="2" data-q="Slides are for…" data-options="Reading|Playing"></div>
```
A card on the big screen that leans toward the room's choice, and flies to the winning side at
`data-close`. Phones swipe the card (or tap a side). Exactly two options: left|right.

### Tap race: `.sop-tap`

```html
<div class="sop-tap" data-step="1" data-close="2" data-label="Tap as fast as you can!"></div>
```
Phones get a big button; the big screen counts the room's taps live. Use talk.js to turn taps into
something visual (see `talks/hello-world/talk.js`, a battery that charges).

### Results: `.sop-results`

```html
<div class="sop-results"></div>
```
The room's score: people, the winner of every poll and swipe, tap totals. Phones switch to the
thank-you screen with your `links`.

### Votes and going back

Every widget has its own counts (its id is `<slide-id>-<n>`, or set `data-live="my-id"`). Going back
to a slide continues its counts; "New session" on the remote clears everything.

## talk.js (optional)

```js
SOP.on('tap', {                 // slide data-id
  enter(el, sop) {},            // slide arrived
  step(el, n, sop) {},          // step n shown
  leave(el, dir, sop) {},       // leaving forward; may return a Promise (max 3 s)
  reset(el) {},                 // slide left or replayed: undo your changes
});
SOP.onLive((state) => {});      // every live update: state.players, state.live, state.counts, state.taps, state.results
SOP.live                        // the latest live state (null when offline)
SOP.slide, SOP.step             // where the deck is right now: slide data-id and step number
SOP.next(); SOP.prev();         // move like the presenter would
SOP.sfx('win');                 // blips: step, tap, join, up, win, ding, or 'assets/sound.mp3'
SOP.music('assets/song.mp3');   // start a looping track (SOP.music(null) stops it)
SOP.confetti(150);
SOP.countUp(el, 1234);          // animated number
SOP.typeText(el);               // typewriter
await SOP.wait(500);            // pause, in ms
```

Keep effects in `reset` reversible: the deck replays steps instantly when the presenter goes back.

## Keys on the deck

→ / space / click / swipe: next · ← back · **F** fullscreen · **P** presenter view on this computer ·
**B** black screen · **M** mute · **K** pair this screen · Home: first slide.
The pairing page is `<talk>/pair` (also `<talk>/baglan`).
URL extras: `?s=<slide-id>&n=<step>` opens at a slide, `?live=0` turns the live layer off.
