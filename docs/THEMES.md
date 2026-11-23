# Themes: make it look like your talk

Everything Show of Phones draws (the deck, the audience phone page, the phone remote, the pairing
screen) is painted with a small set of design tokens: CSS variables that start with `--sop-`.
Change the tokens and all three screens change together. Your talk never needs to touch the engine.

There are three levels, from quick to total control.

## 1. Pick a preset

In `talk.json`:

```json
{ "theme": "house" }
```

| preset | feel |
|---|---|
| `house` (default) | a dark theatre: velvet purple, a tungsten spotlight, green and red cue lights, tall condensed headlines, vote bars made of little phones |
| `daylight` | bright rooms and classrooms: cool white, ink, cobalt and coral, plain bars, no glow |
| `arcade` | pixel font, square blocks; the look of the OKTAY.EXE talk this project grew from |

## 2. Adjust tokens in talk.json

Start from a preset and override what you need. These keys apply to the deck, the phones and the
remote:

```json
{
  "theme": {
    "preset": "house",
    "bg": "#0f1d2b",
    "panel": "#17293b",
    "fg": "#f4f7fb",
    "muted": "#9db0c4",
    "accent": "#ff7a45",
    "accent2": "#5ad1c9",
    "colors": ["#ff7a45", "#5ad1c9", "#ffd166", "#ef476f", "#9b8cff", "#7bd389"],
    "display": "\"Fraunces\", Georgia, serif",
    "displayWeight": 600,
    "displayCase": "none",
    "radius": "6px",
    "bars": "solid"
  }
}
```

| key | token | what it changes |
|---|---|---|
| `bg`, `panel`, `line` | `--sop-bg`, `--sop-panel`, `--sop-line` | background, raised surfaces (cards, tickets, remote boxes), dividers |
| `fg`, `muted` | `--sop-fg`, `--sop-muted` | main and secondary text |
| `accent`, `accent2`, `onAccent` | `--sop-accent`, `--sop-accent-2`, `--sop-on-accent` | highlights (kickers, QR frame, counters) and the text colour on top of the accent |
| `go`, `stop` | `--sop-go`, `--sop-stop` | the cue lights: the remote's Next button, connected / standby dots |
| `colors` | `--sop-c1` … `--sop-c6` | one colour per vote option (also the lobby seats and confetti) |
| `font` | `--sop-font` | body text (a font the viewer's device doesn't have must be loaded in talk.css, see section 3) |
| `display`, `displayWeight`, `displayCase`, `displayTracking`, `displayLeading` | `--sop-display…` | headlines, numbers, option labels |
| `radius`, `radiusLarge` | `--sop-radius`, `--sop-radius-lg` | corner rounding of small and large surfaces |
| `spot` | `--sop-spot` | the light pool on the background (any CSS background, or `"none"`) |
| `bars` | `--sop-bar-mask`, `--sop-bar-cell` | vote bars: `"phones"` (lit phone cells), `"blocks"` (square cells) or `"solid"` |

Pick colours with enough contrast for a projector in a bright room: projectors wash out dark greys
and pale colours first.

## 3. Write your own CSS

`talk.css` is loaded by the deck, the phone page and the remote. Use it for anything the keys above
don't cover, including your own fonts:

```css
/* talks/my-talk/talk.css */
@font-face {
  font-family: "My Brand";
  src: url("assets/my-brand.woff2") format("woff2");
  font-weight: 100 900;
}
:root {
  --sop-display: "My Brand", sans-serif;
  --sop-display-weight: 750;
  --sop-display-case: uppercase;
  --sop-display-tracking: 0.02em;
}

/* only on the big screen */
body.sop-deck .slide h1 { font-size: 200px; }
/* only on the audience phones */
body.sop-phone .ticket { transform: rotate(-2deg); }
/* only on the remote */
body.sop-remote button.big { border-radius: 999px; }
/* only in portrait (phones, upright tablets) */
body.portrait .split { gap: 30px; }
```

Paths inside `talk.css` (like `url("assets/my-brand.woff2")`) are relative to `talk.css` itself, so the
same font or image works on the deck, the phones and the remote.

### Every token

| token | default (house) |
|---|---|
| `--sop-bg` | `#1e1233` |
| `--sop-panel` | `#2c1c49` |
| `--sop-line` | `#4a3670` |
| `--sop-fg` | `#f3eeff` |
| `--sop-muted` | `#a99bc9` |
| `--sop-accent` | `#ffc24b` |
| `--sop-accent-2` | `#7cc8ff` |
| `--sop-on-accent` | `#1e1233` |
| `--sop-go` / `--sop-stop` | `#3ddc97` / `#ff4d6d` |
| `--sop-c1` … `--sop-c6` | `#ffc24b #7cc8ff #ff6f91 #3ddc97 #c3a6ff #ff9a4d` |
| `--sop-font` | Atkinson Hyperlegible Next |
| `--sop-display` | Big Shoulders Display |
| `--sop-mono` | system monospace |
| `--sop-display-weight` / `-case` / `-tracking` / `-leading` | `800` / `none` / `0.005em` / `0.92` |
| `--sop-radius` / `--sop-radius-lg` | `14px` / `28px` |
| `--sop-phone` | the phone-shaped cell (an SVG mask) |
| `--sop-bar-mask` / `--sop-bar-cell` / `--sop-bar-glow` | `var(--sop-phone)` / `30px` / `10px` |
| `--sop-spot` | a warm radial light from the top |
| `--sop-ease` | `cubic-bezier(.2, .8, .2, 1)` |

Bundled fonts (SIL Open Font License): Atkinson Hyperlegible Next, Big Shoulders Display, Pixelify
Sans, Spline Sans Mono.

## Contributing a preset

Add a `[data-theme="name"] { … }` block to `engine/theme.css` that sets the tokens (it inherits
anything it leaves out from `house`), check the deck, a phone and the remote in landscape and
portrait, and open a pull request with a screenshot.
