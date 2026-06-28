# Roleplay Studio (frontend)

A SillyTavern-style roleplay/authoring SPA for the local model, built for writing
character-driven, branching interactive fiction (quests, romance, game scripts).

## Run

Easiest: double-click **`..\start-studio.bat`** — it ensures Ollama is up, starts the
dev server, and opens the browser. Or manually:

```bash
npm install      # first time
npm run dev      # http://localhost:5173
```

Requires the Ollama server running on `:11434` with the `supergemma4-unc` model
(see ../README.md / ../setup/setup.ps1). The browser reaches Ollama only through
the Vite dev-server proxy configured in `vite.config.ts` (`/ollama/*` → `:11434`),
so no CORS configuration is needed.

## Architecture

- **React 18 + Vite + TypeScript.**
- **State:** `src/store.ts` (Zustand, persisted to `localStorage` under
  `localllm-roleplay-studio`). Holds characters, persona, chats, settings.
- **Model I/O:** `src/api/ollama.ts` — streaming SSE client for the OpenAI-compatible
  endpoint. Surfaces both `content` and the reasoning model's separate `reasoning`
  field. `max_tokens` is omitted when 0 (a low cap is eaten by reasoning → empty reply).
- **Prompt assembly:** `src/prompt.ts` — builds the system prompt from the character
  card + persona, applies `{{char}}`/`{{user}}` macros.
- **Generation loop:** `src/useGeneration.ts` — chat send / regenerate (swipe) / stop.
- **Authoring generators:** `src/generators.ts` + `src/json.ts` — character generation,
  story beats, and dialogue-tree nodes. Each asks for strict JSON and parses it from the
  `content` field with a balanced-JSON extractor (reasoning lives in a separate field).
- **UI:** `src/components/*` — Sidebar (mode nav), ChatView, StoryView, TreeView,
  MessageItem (reasoning panel, swipes, edit/delete), MessageInput, CharacterEditor
  (with AI generate), PersonaEditor, SettingsPanel.

## Modes & exports

- **Chat**, **Story** (multi-character auto-play with a length control), and **Dialogue
  Tree** (branching, depth × breadth bounded).
- Story exports `localllm-story@1` JSON (`beats[]` with `speaker`/`type`/`text`) + Markdown.
- Dialogue tree exports `localllm-dialogue-tree@1` JSON (`nodes{}` with `options[].next`)
  — a ready dialogue graph for a game. Both schemas are documented in `../README.md`.

## Data model

A **Character** is a card (description, personality, scenario, first message,
example dialogue, system prompt). A **Chat** belongs to a character and holds the
message list; assistant messages keep alternate generations in `swipes`. Everything
lives in the browser — clearing site data resets it. Use a chat's **Export** button
to save a transcript as Markdown.

## Roadmap

World info / lorebooks (keyword-triggered context for quest state), SillyTavern card
import (PNG/JSON), group chats, quest/relationship state tracking.
