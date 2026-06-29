# Aphelion — Brand Guidelines

**Maker:** Penumbra **Product:** Aphelion **Motif:** corona eclipse + aphelion orbit
**Aesthetic:** dark void · cyan/violet glow · HUD framing · monospace accents

> **Aphelion** (n.) — the point in an orbit farthest from the sun. The product name is the brand idea: your AI, held at the farthest, safest point from the cloud. The mark shows it literally — a lone planet at the far vertex of an orbit around the eclipse void.

---

## Logo

The mark is a **corona eclipse orbited by a single planet at its aphelion**. A pure-black disc is ringed by a luminous corona sweeping cyan (upper-left) → violet → magenta (lower-right); a tilted elliptical orbit encircles it, with a glowing magenta planet sitting at the far vertex — the aphelion. It reads as an eclipse, an aperture, and a quiet solar system all at once.

**Lockups**
- **Horizontal** — mark + "Aphelion" + mono tagline. Default for sites, headers, docs.
- **Stacked** — mark over wordmark. Use in square/centered spaces (avatars, splash, cards).
- **Icon / corona-eclipse mark** — the glowing ring + orbit + planet alone. Favicons, app tiles, social avatars.
- **App icon** — the mark inside a glossy, neon-bordered rounded square. Windows app tile / installer.
- **One-color** — flat annulus + orbit + planet + wordmark, recolorable via the SVG `color` attribute. Stamps, embossing, single-ink contexts, light backgrounds.
- **Penumbra monogram (P)** — the maker's mark. Use in "by Penumbra" credits, not as the product logo.

**Clear space**
Keep clear space of **at least the eclipse's radius (R)** outside the orbit on all sides. Nothing — text, edges, other logos — enters that zone.

**Minimum size**
Icon mark: 28 px (the orbit + planet need room to read; below this, use the corona-eclipse without the orbit). Horizontal lockup: 150 px wide.

**Don'ts**
- Don't recolor the corona gradient or flatten it to a single hue (except the dedicated one-color asset).
- Don't place the full-color mark on light backgrounds — use the one-color asset instead.
- Don't move the planet off the orbit's far vertex, add multiple planets, or animate the orbit in a static lockup.
- Don't add drop shadows or rotate the lockup. The corona's cyan always sits upper-left.
- Don't stretch, condense, or re-typeset the wordmark.

---

## Color

| Token | Hex | Role |
|---|---|---|
| Corona | `#5EEAD4` | Primary glow — mint-teal. Rings, links, primary accents. |
| Flare | `#22D3EE` | Secondary glow — cyan. Gradients, hover, emphasis. |
| Magenta | `#FF79C6` | Accent — **the aphelion planet**. Sparing, ~5% of any layout. |
| Violet | `#C084FC` | Accent — secondary pop, planet core. Badges, gradient mid-stop. |
| Void 900 | `#07021A` | Deepest base background. |
| Void 800 | `#0C0426` | Surfaces / cards. |
| Void 700 | `#130A30` | Raised panels / inputs. |
| Text | `#ECFEFF` | Primary text on void. |
| Text dim | `#9DB4BC` | Secondary / muted text. |
| Text faint | `#5A6B78` | Labels, captions, disabled. |

**Signature gradient:** cyan `#22D3EE` → corona `#5EEAD4` → violet `#C084FC` → magenta `#FF79C6`, swept diagonally (the corona sweep). Use for the mark, primary CTAs, and accent rules — never for body text or large fills. The planet is a magenta→violet radial with a near-white specular highlight.

**Ratio:** ~85% void, ~12% text, ~3% glow/accent. The darkness is the brand; the glow earns its impact by being rare.

---

## Typography

| Role | Typeface | Weights | Notes |
|---|---|---|---|
| Headings & wordmark | **Space Grotesk** | 400 / 500 / 700 | Tight tracking (`-0.02em`) at display sizes. Medium (500) is the default headline weight. |
| Body | **Space Grotesk** | 400 | Line-height 1.6. |
| Mono / labels / data | **JetBrains Mono** | 400 / 500 | UPPERCASE with `0.18–0.24em` tracking for labels, chips, taglines, status. |

Fallbacks: `Space Grotesk → Segoe UI → system-ui → sans-serif`; `JetBrains Mono → Consolas → monospace`.

**Voice in type:** Space Grotesk says the human thing ("Your own AI."); JetBrains Mono says the machine thing ("100% OFFLINE · YOUR GPU"). Pair them — never use mono for long prose or Grotesk for technical labels.

---

## Voice & tone

Confident, plain-spoken, technical-when-it-counts. We sell control and privacy without fear-mongering.

- **Direct over clever.** "Runs on your machine." not "Unleash the power of edge intelligence."
- **Concrete over abstract.** Name the thing: GPU, VRAM, offline, no account.
- **Calm authority.** We don't shout. The product is quietly powerful; the copy is too.
- **Respect the user.** They're capable. No hand-holding, no hype, no dark patterns.
- **Mono for proof, Grotesk for promise.** Claims in mono caps; ideas in Grotesk.

Say: *local, offline, private, your machine, your rules, no setup, one app, auto-fit.*
Avoid: *unleash, revolutionary, game-changing, seamless, AI-powered (as filler), synergy.*

---

## Taglines

1. **Run LLMs locally. Your data, your rules.**
2. **Your own AI. On your machine. Offline.**
3. **Your AI, at the farthest point from the cloud.**
4. **One app. Your GPU. Zero cloud.**
5. **No servers. No setup. No cloud. Just AI.**

---

*Tokens for every value above ship in `tokens.css` and `tokens.json`. Build against the tokens, not hard-coded hex.*
