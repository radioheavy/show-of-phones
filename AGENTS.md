# AGENTS.md · Show of Phones

Instructions for coding agents (Claude Code, Codex, Cursor and others) working in this repository.
People: start with [README.md](README.md).

## What this is

An engine for interactive talks: a deck on the big screen, a phone remote for the speaker, and the
audience voting, swiping and tapping on their own phones. It runs on the speaker's own Cloudflare
account (one Worker, one Durable Object room per talk). A Claude Code plugin interviews the speaker,
writes the talk and deploys it.

## Two kinds of work, two rules

1. **Writing or editing a talk** (`talks/<slug>/`): this is almost always what a user wants. Do not
   touch `engine/`, `worker/` or `cli/` for it. The format is plain HTML: read
   [docs/FORMAT.md](docs/FORMAT.md) first, look themes up in [docs/THEMES.md](docs/THEMES.md), copy
   patterns from [talks/hello-world](talks/hello-world) (Turkish twin: [talks/merhaba-salon](talks/merhaba-salon)).
   The guided flow lives in the skill: [plugin/skills/show-of-phones/SKILL.md](plugin/skills/show-of-phones/SKILL.md).
2. **Changing the engine** (`engine/`, `worker/`, `cli/`): keep it dependency-free plain JS with no
   build step, keep the talk format backwards compatible, and keep every screen working in the three
   themes (`house`, `daylight`, `arcade`) and in TR and EN (`engine/i18n.js`).

## Map

| path | what |
|---|---|
| `engine/deck.*` | the deck: slides, steps, transitions, live widgets, keys, pairing, `window.SOP` API |
| `engine/play.*` | the audience phone page (`/<talk>/play/`) |
| `engine/remote.*` | the speaker's phone remote (`/<talk>/remote/`, needs the admin key) |
| `engine/theme.css` | design tokens (`--sop-*`) and the three presets |
| `engine/i18n.js` | interface strings, `en` and `tr` |
| `worker/index.js` | Worker + `Room` Durable Object: `/api/<talk>/{join,vote,tap,state,pair,admin}` |
| `cli/sop.mjs` | `npm run sop …`: new, dev, cloud, deploy, open, remote, key, check, build |
| `talks/` | one folder per talk; `_`-prefixed folders are never built (`_template`) |
| `docs/` | FORMAT.md (talk format), THEMES.md (styling); copies ship in `plugin/skills/show-of-phones/references/` |
| `plugin/` | the Claude Code plugin and its skill; `.claude-plugin/marketplace.json` makes this repo a marketplace |

## Commands

```bash
npm install
npm run sop new <slug> "<Title>"   # new talk from talks/_template
npm run check                      # validate every talk (run after any talk edit)
npm run dev                        # local server with the live layer; prints keyed URLs. Long-running: start it in the background
npm run build                      # assemble dist/ only
npm run sop cloud                  # Cloudflare checks: login, account, deployment name, address
npm run deploy                     # build + deploy to the user's own Cloudflare account
```

Verify a change by running `npm run check`, then `npm run dev` and opening the printed deck URL and
`/<talk>/play/` (a phone-sized window). There is no unit-test suite; the check plus a real walk-through
is the test.

## Never

- Print, log, commit or project the admin key (`.sop/admin.key`, `.dev.vars`). The remote URL and its
  QR contain it: never show them on a shared screen.
- Commit `sop.config.local.json`, `.dev.vars`, `.sop/` or `dist/` (all git-ignored).
- Use `npm run sop -- cloud --takeover` unless the user explicitly says the existing deployment with
  that name is theirs to replace.
- Create Cloudflare accounts or type passwords for the user: they run `npx wrangler login` themselves.
- Add runtime dependencies or a build step to the engine.

## Docs stay in sync

When you change the talk format or a theme token, update `docs/FORMAT.md` / `docs/THEMES.md` **and**
their copies in `plugin/skills/show-of-phones/references/`, and both READMEs (`README.md`, `README.tr.md`).
