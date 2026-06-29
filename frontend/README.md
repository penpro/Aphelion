# Aphelion — frontend

The React + TypeScript + Vite frontend for **Aphelion** (by Penumbra), wrapped in [Tauri](https://tauri.app/).

See the root [README](../README.md) for what Aphelion is and how to install it. Build-from-source steps live in that README's **For developers** section (`npm install`, `npm run fetch-engine`, `npm run tauri build`).

**Stack:** React 18 · TypeScript · Vite · Zustand (state persisted to `localStorage`). The UI talks to the bundled llama.cpp server over its OpenAI-compatible API (`src/api/ollama.ts`); design tokens live in `src/brand-tokens.css`.
