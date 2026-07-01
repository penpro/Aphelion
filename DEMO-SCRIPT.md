# Aphelion — Demo Video Script & Shot Checklist

A ready-to-record script for a product demo of **Aphelion** (by Penumbra). Two cuts are
described: a **~60s trailer** (hook only) and a **~3–4 min walkthrough** (the full tour).
Record the walkthrough first — the trailer is a re-cut of its best moments.

- **Target length:** 3–4 min walkthrough · 60s trailer
- **Resolution / fps:** 1920×1080 (or 2560×1440), 60fps, capture the Aphelion window only (not the whole desktop)
- **Tone:** calm, confident, "this runs on *your* machine." No hype-voice. Let the glow and the motion do the selling.
- **Theme for capture:** default **penumbra** (cyan corona on deep space) reads best on video.

---

## Pre-flight checklist (do this before you hit record)

- [ ] Update to the **latest build** so the UI matches (portrait sets, live portrait, welcome tour, stat chips).
- [ ] A capable **model already downloaded** so the splash fills fast and generation is snappy (record on the 4090).
- [ ] Prepare **one hero character** with a *complete* portrait set: all 8 emotions filled, plus a **second named set** (e.g. "Hair up" / "Hair down") so you can show the set dropdown. Use a **SFW** character for the public demo.
- [ ] Have a **second character** ready so you can show a group chat (optional).
- [ ] Draft the **one-line character prompt** you'll type live (see scene 3) so you don't fumble.
- [ ] Pick an **Ask question** that clearly benefits from an expert (see scene 5).
- [ ] Close notifications / other windows. Set the window to a clean size (~1400×900).
- [ ] If you want the **welcome tour** on camera: in Settings you'll need `seenWelcome` reset — easiest is to click **Quick tour** in the sidebar footer to replay it on demand.
- [ ] Do one **dry run** end-to-end. Generation latency is the only thing that can make it drag — pre-warm the model (keep-loaded on) so the first token is instant.

---

## The walkthrough script

> Format: **[timecode] SCENE — on-screen action** · *VO / narration* · `capture note`

**[0:00] COLD OPEN — the splash**
- Action: Launch Aphelion. The eclipse splash appears, VRAM gauge **filling** as the model loads, then fades into the app.
- *VO: "This is Aphelion. A full AI studio — characters, roleplay, an expert assistant — running entirely on your own GPU."*
- `capture note:` start recording a beat before launch so you catch the splash fill. This is your best 3 seconds — don't cut it short.

**[0:08] THE SHELL — menu bar + stat chips**
- Action: Slow pan across the top bar: brand mark → the hero mode tabs (Chat / Ask / Story / Tree) → the live chips on the right (engine status · model · VRAM · context).
- *VO: "Everything's here in one bar — your modes on the left, and on the right, exactly what's loaded: the engine, the model, your VRAM, your context window. No mystery."*
- `capture note:` hover a chip if it has a tooltip. Keep the cursor movements slow and deliberate.

**[0:20] WELCOME TOUR — onboarding overlay** *(optional, but great for a first-run story)*
- Action: Click **Quick tour** in the sidebar footer. Step through the welcome overlay (the corona mark, the feature cards), landing on the "Yours, and private" step. Check nothing; click **Get started**.
- *VO: "First launch walks you through it — and it's the first hint of the whole pitch: this is yours, and it's private."*
- `capture note:` the progress dots + fade between steps look good on video. Don't rush the steps.

**[0:32] CHARACTERS — create & generate**
- Action: Open the character editor → **New**. Type your one-line prompt into "Generate from criteria" (e.g. *"a weathered desert cartographer who maps places that don't exist yet"*). Click **Generate**. Fields fill in.
- *VO: "Make a character from scratch — or describe one in a sentence and let the model build the sheet: personality, backstory, the way they talk."*
- `capture note:` this is a live generation — pre-warm so it streams fast. If it's slow, cut to the filled result.

**[0:50] PORTRAIT SETS — the new part**
- Action: Scroll to **Portrait sets**. Click **+ New set**, name it "Hair up," upload the 8 emotion slots (or show them already filled). Add a **second set** ("Hair down"). Show the **✨ Art prompts** button revealing the copy-paste image prompts.
- *VO: "Give them a face. A portrait set is a named look — an outfit, a mood — with a portrait for each of eight emotions. Make as many looks as you want. And if you need the art, Aphelion writes the image prompts for you, kept consistent across the whole set."*
- `capture note:` this is the headline feature — linger here. Show the tab switch between the two named sets.

**[1:15] LIVE PORTRAIT — expression follows the scene**
- Action: Open a chat with that character. Turn on **Live portrait** in Tuning (show the **Small / Medium / Large** control and the **Portrait set** dropdown). Send a message that provokes a clear emotion; when the reply lands, the portrait **switches** to match the mood.
- *VO: "Turn on the live portrait, and it reads the tone of each reply and shows the matching expression — no flicker, it settles on the whole reply. Switch looks mid-scene from the dropdown."*
- `capture note:` script the exchange so the emotion shift is obvious (e.g. something that lands as *happy* → then *angry*). The switch is the payoff shot.

**[1:40] CHAT CRAFT — tuning, memory, sources**
- Action: Quick tour of the Tuning rail: **Dialogue ↔ Prose** slider, **Response length**, **Intensity**, **Thinking** on/off. Mention **Sources** (drop in a doc) and the rolling **summary** memory. Optionally add a 2nd character → group chat.
- *VO: "Dial in the voice — more prose or more banter, longer or tighter, how much it reasons. Drop in reference docs it can pull from. And long chats never overflow — older turns fold into a running memory."*
- `capture note:` don't dwell; this is a montage of sliders moving. 3–4 seconds each.

**[2:05] ASK MODE — the routed expert**
- Action: Switch to **Ask**. Type a question that suits an expert (e.g. a photography or code question). Show the **expert emblem** and the **ExpertPicker** dropdown; mention the intent router quietly choosing. Let the answer stream.
- *VO: "Switch to Ask, and your question gets routed to a tuned expert — code, photography, writing — or pick one yourself. Same local model, wearing the right hat."*
- `capture note:` pick a question where the expert framing visibly changes the answer's quality/format.

**[2:30] STORY / TREE — breadth** *(brief)*
- Action: Flash the **Story** and **Tree** modes — just enough to show they exist.
- *VO: "There's long-form story tooling and a branching tree view when you want to explore where a scene could go."*
- `capture note:` 2–3 seconds each, no deep dive.

**[2:40] PRIVACY & SETTINGS — the closer**
- Action: Open **Settings** → show model management, **Advanced sampling** (scroll the sliders), **Updates** (the manual "Check for updates"), and the **theme** presets (flip one for a beat, flip back).
- *VO: "Every knob's exposed — samplers, models, themes — and updates are one click when you want them. But the point is what's* not *here: no account, no cloud. The model never touches your files or the network — the app does everything, on your machine. Unplug the internet and it still works."*
- `capture note:` the theme flip is a nice visual button. The "unplug the internet" line is the mic-drop — land it on the corona mark or the offline chip.

**[3:00] END CARD**
- Action: Cut to the Aphelion wordmark / eclipse on deep space.
- *VO: "Aphelion. Local AI, all yours."*
- `capture note:` hold 2s. Add the site URL (penpro.github.io/Aphelion) as a lower-third.

---

## 60-second trailer (re-cut)

Splash fill → stat chips (1s) → portrait set tabs (2s) → **live portrait emotion switch** (2s, the hero shot) → Ask expert emblem (2s) → theme flip (1s) → "unplug the internet, it still works" line over the offline chip → end card. Fast, musical, no full sentences except the closer.

---

## Capture & post checklist

- [ ] Record at 60fps — the glow, the portrait crossfade, and the splash fill all rely on smooth motion.
- [ ] Cursor: enable click-highlight if your recorder has it; move slowly.
- [ ] Audio: record VO separately and lay it under; don't narrate live over a laggy generation.
- [ ] Trim every dead moment waiting on tokens (pre-warm to minimize these).
- [ ] Music: something ambient/synthy that matches the deep-space brand; duck under VO.
- [ ] Export 1080p/1440p H.264, plus a square/vertical crop of the **live-portrait switch** for socials.
- [ ] Keep it **SFW** for anything public — use the neutral hero character, not the mature cards.

## One-glance shot checklist (tick while recording)

- [ ] Splash fill  - [ ] Stat chips pan  - [ ] Welcome tour  - [ ] Character generate
- [ ] Portrait sets (two named looks + art prompts)  - [ ] **Live portrait emotion switch**
- [ ] Tuning sliders  - [ ] Sources / group chat  - [ ] Ask expert + router
- [ ] Story/Tree flash  - [ ] Settings (samplers/updates/theme)  - [ ] "Offline still works" closer  - [ ] End card
