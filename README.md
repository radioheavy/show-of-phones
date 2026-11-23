# Show of Phones 📱

**Every talk starts with “please put your phones away.” Yours won’t.**

Show of Phones turns a talk into a game the room plays. Three screens, one live room:

- **The stage**: your deck on the projector. Polls fill up, cards lean, counters fly as the room answers.
- **Your pocket**: your phone is the remote (next, back, black screen, jump, notes, timer, live counts).
- **The room**: everyone scans one QR code and votes, swipes and taps on their own phone. No app.

And you don't build it by hand: **Claude interviews you like a talk coach, writes the deck, deploys it
to your own Cloudflare account and gets you ready for the venue.**

**Live demo & landing:** https://showofphones.oktaydak.com · **Demo deck:** https://showofphones.oktaydak.com/hello-world/
· 🇹🇷 [Türkçe README](README.tr.md)

You need: [Node.js](https://nodejs.org) 18 or newer, a free [Cloudflare](https://dash.cloudflare.com/sign-up)
account to put talks online, and [Claude Code](https://claude.com/claude-code) for the guided way.

## Quick start with Claude Code (recommended)

```
/plugin marketplace add radioheavy/show-of-phones
/plugin install show-of-phones@show-of-phones
```
Then type `/show-of-phones` or just say *“help me build an interactive talk”*. Claude asks about your
talk, your room and your story, shows you a draft early, places the live moments, deploys it and hands
you a venue checklist.

## By hand

```bash
git clone https://github.com/radioheavy/show-of-phones
cd show-of-phones && npm install
npm run sop new my-talk "My talk"   # creates talks/my-talk/
npm run dev                         # runs locally with the live layer, prints keyed URLs
```

Edit `talks/my-talk/slides.html`. A live poll is one line:

```html
<div class="sop-poll" data-step="1" data-close="2"
     data-q="Where are you right now?" data-options="Front row|Back row|At home"></div>
```

Full format: [docs/FORMAT.md](docs/FORMAT.md). Make it look like your talk: [docs/THEMES.md](docs/THEMES.md) (one theme styles the deck, the phones and the remote). Complete example: [talks/hello-world](talks/hello-world) (and its Turkish twin [talks/merhaba-salon](talks/merhaba-salon)).

### Put it online (free Cloudflare plan is enough)

```bash
npx wrangler login                     # once: opens your browser
npm run sop -- cloud --name=my-talks   # pick a name; checks login, account and that the name is free
npm run deploy                         # first run creates your admin key (.sop/admin.key) and uploads it
npm run sop open my-talk               # opens the deck with the key (live layer on)
npm run sop remote my-talk             # QR for your phone remote. It contains the key: never project it.
```

`npm run sop cloud` tells you what is missing at any time. You get a free `my-talks.<you>.workers.dev`
address; for your own domain (its DNS zone on the same account): `npm run sop -- cloud --domain=talk.example.com`.
Deploy refuses to replace a deployment with the same name that was not made from your folder.
The root address lists your talks; folders starting with `_` (like `_template`) are never published, so
put a `_` in front of `hello-world` and `merhaba-salon` if you don't want the examples online.

### At the venue

On any computer (no install, no password typed on stage):

1. Open `https://your-domain/my-talk/pair`, and a 6-digit code appears.
2. On your phone remote tap **📺 Connect screen** and type the code.
3. Press **F** for fullscreen. Done. The pairing lasts 12 hours and survives reloads.

No internet? The deck still runs; live parts step aside.

## What's inside

| | |
|---|---|
| `engine/` | deck engine, phone page, remote, themes, TR/EN strings (plain JS, no build step) |
| `worker/` | Cloudflare Worker + one Durable Object room per talk (votes, taps, pairing, remote commands) |
| `cli/sop.mjs` | `new`, `dev`, `cloud`, `deploy`, `open`, `remote`, `key`, `check`, `build` |
| `talks/` | your talks (`_template`; examples `hello-world` and `merhaba-salon`) |
| `site/` | optional: your own landing page, served at the root (create it, or point `"site"` in `sop.config.local.json` at another folder). Files listed in `site.json` `"private"` are not served |
| `plugin/` | the Claude Code plugin and skill |

Live widgets: **poll** (2–6 options), **swipe** (one card, two sides), **tap race**, **join** (QR +
counter), **results** (the room's score). Venue-proof details: pairing code, resume after reload,
offline fallback, portrait and landscape layouts, the remote keeps the phone awake, stale remote
commands are never replayed.

## Where it comes from

Show of Phones was born as **OKTAY.EXE**, a 10-minute talk at Claude Game Jam (Istanbul, 21.11.2026)
about making three iPhone games with AI. The room survived an elevator, swiped a 1956 card and fed a
tiny AI with taps. People asked how to do the same; this is that, cleaned up and open for everyone.
Original talk: https://jam.oktaydak.com

## For agents

Coding agents: read [AGENTS.md](AGENTS.md) (Claude Code picks it up through `CLAUDE.md`). An index for
language models is in [llms.txt](llms.txt), and the landing serves one at
https://showofphones.oktaydak.com/llms.txt plus a guide at https://showofphones.oktaydak.com/for-agents.

## Contributing

New widgets (quiz, word cloud, Q&A), languages (`engine/i18n.js`) and themes are very welcome. Keep the
engine dependency-free and the talk format plain HTML.

MIT License.
