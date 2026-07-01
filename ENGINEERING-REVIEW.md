# Aphelion — Engineering Review & Hardening Backlog

A critical software-engineering audit (Rust backend, React/TS frontend, persistence, testing, portability), ranked by severity. Checkboxes track what's fixed. Audited at ~9,200 frontend LOC + ~1,100 Rust LOC, 53 tests.

> **North star:** no user action should ever silently lose data or wedge the app; the model touches nothing but text; every layer is decoupled and testable.

---

## Tier 1 — Ship-blockers (silent data loss / unrecoverable crash)

- [x] **1. localStorage quota = silent total data loss** *(v0.1.35 — safety net; cause-fix pending)*
  The whole store (incl. **user-uploaded portrait data-URLs**, 80–150 KB each × 8 emotions × N sets) serializes to a ~5 MB `localStorage` with no guard (`store.ts` persist, `image.ts:23`). On `QuotaExceededError`, zustand-persist swallowed it → write dropped → data loss on next launch. Trips at ~5–6 user-illustrated characters. **Violates our own standard #6** ("images aren't persisted").
  - [x] Wrap persist storage so quota/parse failures never crash and surface a warning (`storage.ts` `safeStorage`, v0.1.35).
  - [x] Export / Import backup valve in Settings + a storage-full banner (v0.1.35).
  - [ ] **Cause fix:** move portraits to disk via Tauri fs; store a path/ref, not base64. Render via `convertFileSrc` (CSP already allows `asset:`). *(the real fix — next)*
  - *Note: seed/Seraphina portraits are bundled asset URLs, not data-URLs — they cost ~nothing. Only user-created sets bloat storage.*

- [x] **2. No React error boundary → white-screen, unbootable** *(v0.1.35)*
  Corrupt persisted JSON or any render throw = blank screen, no recovery.
  - [x] Top-level `ErrorBoundary` with Reload / Export / Reset recovery UI.
  - [x] Defensive rehydration: corrupt store → boot on defaults, not a crash (`storage.ts` `getItem`).

- [ ] **3. Engine spawn is fire-and-forget + lock poisoning (Rust)**
  - [ ] `spawn_engine()` (`engine.rs:29-70`) returns before the port is listening and ignores a **stale process on 127.0.0.1:11435** — poll for readiness / adopt-or-kill a stale listener before reporting success.
  - [ ] Every `.lock().unwrap()` has no poison recovery → one panic under a lock (a PDF slipping the `catch_unwind`) cascades a backend crash. Use poison-tolerant access.
  - [ ] Child stdio undrained (`engine.rs:60`, `vision.rs:57`) → pipe-buffer deadlock. Add `Stdio::null()`.

---

## Tier 2 — Decoupling & maintainability

- [ ] **4. No Tauri boundary — ~49 `invoke()` across 24 components** (violates "go through `api/`"). Add `services/tauri.ts` with typed wrappers; components call functions, not `invoke`. Also fixes the 15+ untyped `invoke<string>` returns.
- [ ] **5. God-components/modules.** `AskView` (~600), `generators.ts` (~590, streaming loop copy-pasted 4×), `store.ts` (~580 monolith), `SettingsPanel` (~500), `StoryView`/`DocumentModal` (~470). Extract hooks (`useAskGeneration`, `useStoryGeneration`, `useDialogueGeneration`), split `generators.ts` by domain behind one `streamWith()` helper, pull merge/migration into `migrations.ts`.
- [ ] **6. `MessageItem` not memoized** → every streaming token re-renders the whole list. `React.memo` + `useCallback`.

---

## Tier 3 — Papercuts & coverage

- [ ] **7. Swallowed errors** — `.catch(() => {})` in `ModelsModal`/`FolderGrant`/`SetupWizard`/`DocumentModal`; log + show a subtle status.
- [ ] **8. Test coverage gaps** — pure functions are covered (7 files); the load-bearing store `merge()`/migrations and the quota path are not. Add merge (corrupt/partial input) + quota-exceeded tests. *(quota path partially covered by `storage.test.ts` in v0.1.35.)*
- [ ] **9. Rust minor** — temp-file name collisions (use a UUID), symlink TOCTOU in the allowlist (low practical risk), no timeouts on child waits.
- [ ] **10. Release papercut** — version bump is 6 manual edits across 5 files; add `scripts/bump.mjs` (single source of truth).

---

## Genuine strengths (keep these)

Near-zero `any` (1 in 9.2k LOC); clean `api/ollama` isolation with correct SSE-frame + abort handling; sophisticated rolling-memory/distillation; Rust is `Result`-everywhere with `catch_unwind` around `pdf_extract`, strict loopback binding, and a real path allowlist; genuine unit-test discipline; and a written standards doc.

## Corrections to the raw audit

- Seed/Seraphina portraits are **bundled asset URLs**, not data-URLs (don't count toward quota).
- `emotion.ts` / `uiIcons.ts` / `tauri.ts` are **not** dead — all in use.
- The allowlist symlink TOCTOU is real but low-practical-risk (needs local FS write + timing); not a network risk.
