# Local Model + Agent Sandbox

Working area for running the uncensored Gemma-4 derivative locally and (later)
experimenting with a local agent harness. Build order and rationale live in
[CLAUDE.md](CLAUDE.md) — this README tracks the **actual** state of the box.

## Status

| Phase | What | State |
|------|------|-------|
| 0 | Inference layer (Ollama + model + Modelfile) | **done** — `supergemma4-unc` runs, 100% GPU |
| 1 | Console client (`console/chat.py`) | **done** — validated end-to-end through `/v1` |
| 2 | Frontend — Roleplay Studio (`frontend/`) | **v1 done** — React+Vite, streaming verified |
| 3 | Agent harness (OpenClaw/Hermes) | not started (do not start until 1 & 2 are solid) |

## Environment (verified, not assumed)

- Windows 11, **NVIDIA RTX 4090, 24564 MiB (~24 GB)** — confirmed via `nvidia-smi`
  (driver 610.47). Note: Windows WMI reports the 4090 as "4 GB" due to a 32-bit
  `AdapterRAM` overflow bug; ignore it, `nvidia-smi` is authoritative.
- Disk: D: ~1.8 TB free. Python 3.13.14, Node present.
- Ollama **0.30.9** (installed via winget during setup — it was *not* present
  beforehand, contrary to the assumption that the toolchain was ready).
- `OLLAMA_FLASH_ATTENTION=1` set at user scope (KV-cache memory headroom).

### Deviations from CLAUDE.md found at setup

- **Ollama was not installed.** Installed it via `winget install Ollama.Ollama`.
- **KoboldCpp** is installed at `D:\ChatBot\koboldcpp\koboldcpp.exe` (the separate
  chatbot setup), just not on this project's PATH — so the doc's "already installed"
  note is correct. The Ollama path doesn't depend on it; it's there as the backend
  alternative if we ever want llama.cpp's extra knobs.
- Everything else checked out: the model repo, the Gemma-4 base, the 24 GB 4090,
  and the VRAM math are all real/correct.

## Model

- Source GGUF: `hf.co/Jiunsong/supergemma4-26b-uncensored-gguf-v2`
  (`...-Q4_K_M.gguf`, ~16.8 GB). Base: `google/gemma-4-26B-A4B-it` (26B-total /
  4B-active MoE, 256K max context).
- Named model `supergemma4-unc` is created from [Modelfile](Modelfile), which
  sets `num_ctx 32768` (start safe on 24 GB; scale to 65536 once stable) and
  deliberately does **not** override the GGUF's embedded chat template.

## Run it

```powershell
# One-shot full setup / repair (install, pull, create model, smoke test):
powershell -ExecutionPolicy Bypass -File D:\LocalLLM\setup\setup.ps1

# Phase 1 console client:
python D:\LocalLLM\console\chat.py            # interactive REPL
python D:\LocalLLM\console\chat.py "hello"    # one-shot
python D:\LocalLLM\console\chat.py --health   # preflight only
```

Endpoints (OpenAI-compatible is what the client/frontend target):
- `http://localhost:11434/v1/chat/completions`
- `http://localhost:11434/api/chat` (native)

## Phase 1 results & gotchas

Smoke-tested end to end through `chat.py` on the OpenAI `/v1` path:

- **100% GPU**, no CPU spill • **~107 tok/s** • **~8.7 s** cold load • ~17.5 GB at
  32K context (total 20.9/24 GB with Wan2GP also resident — see below).
- **`supergemma4-unc` is a reasoning model.** The `/v1` endpoint returns its
  chain-of-thought in a `reasoning` field and the answer in `content` (native
  `/api/chat` uses `message.reasoning`/`thinking`). **Do not set a low
  `max_tokens`** — reasoning is verbose and a small cap is consumed entirely by
  it, returning an *empty* `content` with `finish_reason: length`. `chat.py`
  handles this (streams the answer, shows reasoning with `--show-thinking`).
- It **confabulates its identity** ("I'm GPT-4o in the cloud"). Expected for these
  fine-tunes; it is 100% local. Use a system prompt if correct self-ID matters.
- **Shared GPU:** Wan2GP (`D:\Wan2gp`) and KoboldCpp (`D:\ChatBot`) also use the
  4090. Wan2GP held ~3.4 GB idle during testing. Check `nvidia-smi` before raising
  context.

## Frontend — Roleplay Studio (Phase 2)

A SillyTavern-style roleplay/authoring SPA in `frontend/`, aimed at writing
character-driven, branching interactive fiction (quests, romance, game scripts).

**Just double-click `start-studio.bat`** (in `D:\LocalLLM`). It ensures Ollama is
running, starts the dev server, and opens `http://localhost:5173`. Close its console
window to stop. (First run installs npm deps automatically.)

Manual equivalent:

```powershell
npm install --prefix D:\LocalLLM\frontend   # first time only
npm run dev   --prefix D:\LocalLLM\frontend  # then open http://localhost:5173
```

Stack: React 18 + Vite + TypeScript, Zustand (state, persisted to `localStorage`),
react-markdown. The browser talks to Ollama only through a Vite dev-server proxy
(`/ollama/*` → `:11434`), so there is no CORS setup and the model never leaves the box.

Four modes (tabs in the sidebar):

**💬 Chat** — character cards (description, personality, backdrop, example dialogue,
per-character system prompt), each field with an **✨ Expand** button that deepens it
via the model. The **scene lives in the chat, not the character**: a new chat opens a
setup panel — read the character/persona, then write or **✨ Expand** / **🎲 Generate**
an opening scene, and **▶ Start chat** (the character opens the scene). A per-chat side
panel of **dials** tunes Dialogue↔Prose, response length, intensity, and a **Thinking**
toggle (off by default) for every reply. Chat replies stream from the **native
`/api/chat`** endpoint so `think:false` actually disables the reasoning trace — without
it, the model's chain-of-thought balloons to ~10k tokens/turn as a chat grows long
(slow + derailed). Story/character generators keep reasoning on (planning helps there).
Chats are **multi-character**: add anyone to the open chat (**＋＋** on a sidebar tile)
and the whole cast shares **one context** — the scene unfolds naturally, with no slow
per-character context switching. The side panel lists the cast with **🔊 mute** (stays
in context but stops speaking) and **✕ remove** (leaves the character intact). When a
message references a new name, an inline **✦ Create [name]** chip builds that character
from the surrounding context and drops them into the scene. The side panel also has a
**Sources** section — attach reference docs (lore, a style sample, world notes, pasted
or loaded from a file) that ride along in context, a text "LoRA" the model draws on.

`{{char}}`/`{{user}}` macros, editable persona, streaming with a collapsible Reasoning
panel, swipes / regenerate / edit / delete, markdown + code, export to Markdown.

**🎬 Story** — pick a **cast** + a one-line **seed idea** (the model fills in the
when/where/flavor), then shape it with **Direction dials** (setting, tone, genre,
POV, pace, intensity, ending), **steer lines** (one-liner touchstones the scene
builds toward), a **flow equalizer** (drag 10 bars for dialogue↔description rhythm
across the scene), and a **length** target in pages/words (Scene ~1pg → Epic ~10pg,
or custom). The model writes screenplay prose, **auto-continuing across several
passes** until it reaches the target — each pass is told to develop slowly and *not*
conclude yet, so long stories unfold instead of racing to the end. A progress bar
tracks words; the live reasoning streams in the planning panel. Regenerate or
**Continue** to extend; Stop keeps partial work. Exports JSON (game-ready) and
Markdown (screenplay).

> Notes: this is a reasoning model, so each pass *thinks* before writing — long
> targets (Epic ~10pg) take several minutes; use the **Keep model loaded** toggle.
> And cast real **named characters** — the seed "Game Master" is a narrator persona
> that makes the model over-deliberate.

**🌳 Dialogue Tree** — give an NPC + situation and a **depth × branches** bound; it
generates a branching conversation (BFS, ~`Σ breadth^d` nodes) that branches on the
player's choices, rendered as a tree. Exports JSON (game-ready).

**🪄 Ask** — a free-form scratchpad for one-off generations ("give me 20 battle-cry
one-liners", "list shady tavern names", "rewrite this paragraph grittier"). No-reasoning
by default (fast); reasoning is one click away, and past asks are saved in the sidebar.

(Story also has a **📚 Sources** panel — same idea as chat sources, for keeping lore /
style references in context while it writes.)

**AI character generation** — in the character editor, type a one-line brief
("✨ Generate from criteria") and the model fills the whole card for you to review.

Settings: model picker (live from `/v1/models`), temperature, top-p, max tokens,
context length, auto-expand-reasoning. Ships with two seed characters.

At the top of the sidebar: a **Keep model loaded** toggle (pins the model in VRAM via
`keep_alive: -1` + a heartbeat, so it doesn't idle-unload while you iterate; turning it
off reverts to the normal 5-min idle-unload), a **Reload** button (unload → reload
fresh, flushing the model's KV/context — your chats are kept), and an **⏏ Unload**
button (frees all the model's VRAM immediately, e.g. before running Wan2GP). A live dot
shows whether the model is currently resident. Note: `keep_alive: -1` is sticky on the
Ollama server, so the toggle/Unload are the only way to release a pinned model.

### Export formats (for Claude Code → game)

Stable, versioned JSON designed for a game pipeline to ingest:

- **Story** `localllm-story@1`: `{ title, premise, characters[], beats[] }` where each
  beat is `{ index, speaker, characterId, type: "dialogue"|"action"|"narration", text }`.
  Extract spoken lines with `beats.filter(b => b.type === "dialogue")`.
- **Dialogue tree** `localllm-dialogue-tree@1`: `{ title, premise, npc, root, nodes }`
  where `nodes[id] = { id, speaker, line, options: [{ text, next }] }`. `next` is a
  node id or `null` (conversation ends) — a ready-made dialogue graph.

**Verified end to end:** all three generators ran live against the model — a
multi-character story (correctly attributed beats), a branching dialogue tree
(root + branches), and a generated character ("Thrainn Emberbeard", a dwarven
blacksmith) — parsing the model's structured output via the `content` field.

**Roadmap (v3):** world info / lorebooks (keyword-triggered context — great for
quest state), SillyTavern character-card import (PNG/JSON), group chats, and
explicit quest/relationship state tracking.

## Next steps

1. Try the Roleplay Studio against the model; tune the seed characters / system
   prompts to taste.
2. Confirm 32K context is stable, then consider bumping the Modelfile to 65536
   (check `nvidia-smi` first — the 4090 is shared with Wan2GP).
3. Phase 3 (later, deferred): agent harness — **independently verify the
   OpenClaw/Hermes/molthub claims and `ollama launch` first** (they did not check
   out during setup), and vet every skill before installing.
