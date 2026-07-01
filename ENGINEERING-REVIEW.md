# Aphelion — Engineering Review & Hardening Backlog

A critical software-engineering audit (Rust backend, React/TS frontend, persistence, testing, portability), ranked by severity. Checkboxes track what's fixed. Audited at ~9,200 frontend LOC + ~1,100 Rust LOC, 53 tests.

> **North star:** no user action should ever silently lose data or wedge the app; the model touches nothing but text; every layer is decoupled and testable.

---

## Tier 1 — Ship-blockers (silent data loss / unrecoverable crash)

- [x] **1. localStorage quota = silent total data loss** *(v0.1.35 — safety net; cause-fix pending)*
  The whole store (incl. **user-uploaded portrait data-URLs**, 80–150 KB each × 8 emotions × N sets) serializes to a ~5 MB `localStorage` with no guard (`store.ts` persist, `image.ts:23`). On `QuotaExceededError`, zustand-persist swallowed it → write dropped → data loss on next launch. Trips at ~5–6 user-illustrated characters. **Violates our own standard #6** ("images aren't persisted").
  - [x] Wrap persist storage so quota/parse failures never crash and surface a warning (`storage.ts` `safeStorage`, v0.1.35).
  - [x] Export / Import backup valve in Settings + a storage-full banner (v0.1.35).
  - [x] **Cause fix (v0.1.37):** new portrait uploads write to disk (`portraits.rs` `save_portrait`); the store holds a small `disk:<path>` ref read back via `convertFileSrc` (asset protocol — `protocol-asset` feature + `$APPDATA/portraits/**` scope). ⚠️ Needs a packaged smoke test — the asset protocol can't be verified locally.
  - [ ] **Migration** of existing data-URL portraits → disk (deferred until after the smoke test, so we don't migrate onto an unverified mechanism). Also: orphan-file cleanup on portrait replace/delete.
  - *Note: seed/Seraphina portraits are bundled asset URLs, not data-URLs — they cost ~nothing. Only user-created sets bloat storage.*

- [x] **2. No React error boundary → white-screen, unbootable** *(v0.1.35)*
  Corrupt persisted JSON or any render throw = blank screen, no recovery.
  - [x] Top-level `ErrorBoundary` with Reload / Export / Reset recovery UI.
  - [x] Defensive rehydration: corrupt store → boot on defaults, not a crash (`storage.ts` `getItem`).

- [x] **3. Engine spawn + lock poisoning (Rust)** *(v0.1.36)*
  - [x] `start_engine` now guards an instant-death spawn (busy port / incompatible model) with `try_wait` → a clear error instead of storing a dead process and hanging the UI.
  - [x] All 33 `.lock().unwrap()` → poison-tolerant `unwrap_or_else(|e| e.into_inner())` across engine/vision/downloads/knowledge/documents/lib — one panic under a lock can no longer cascade-crash the backend.
  - [x] `Stdio::null()` on both llama-server spawns → no pipe-buffer deadlock.
  - [ ] *Deferred:* killing a **truly-orphaned** engine holding the port (after a hard crash) needs a port→PID lookup — future.

---

## Tier 2 — Decoupling & maintainability

- [x] **4. Tauri boundary** *(v0.1.38)* — `src/tauri.ts` is now the single typed boundary (one documented wrapper per command + `ModelFile`/`DownloadInfo` types); all ~43 `invoke()` call sites across 11 files go through it, and `invoke` appears **only** in `tauri.ts`. Fixes the scattered untyped `invoke<T>` calls in one place. (Verified: build + 58 tests green + grep clean.)
- [ ] **5. God-components/modules.** `AskView` (~600), `generators.ts` (~590, streaming loop copy-pasted 4×), `store.ts` (~580 monolith), `SettingsPanel` (~500), `StoryView`/`DocumentModal` (~470). Extract hooks (`useAskGeneration`, `useStoryGeneration`, `useDialogueGeneration`), split `generators.ts` by domain behind one `streamWith()` helper, pull merge/migration into `migrations.ts`.
- [ ] **6. `MessageItem` not memoized** → every streaming token re-renders the whole list. `React.memo` + `useCallback`.

---

## Tier 3 — Papercuts & coverage

- [ ] **7. Swallowed errors** — `.catch(() => {})` in `ModelsModal`/`FolderGrant`/`SetupWizard`/`DocumentModal`; log + show a subtle status.
- [ ] **8. Test coverage gaps** — pure functions are covered (7 files); the load-bearing store `merge()`/migrations and the quota path are not. Add merge (corrupt/partial input) + quota-exceeded tests. *(quota path partially covered by `storage.test.ts` in v0.1.35.)*
- [ ] **9. Rust minor** — temp-file name collisions (use a UUID), symlink TOCTOU in the allowlist (low practical risk), no timeouts on child waits.
- [x] **10. Release bump script** *(v0.1.38)* — `scripts/bump.mjs` (`npm run bump <version|patch|minor|major>`) writes all 5 version files with anchored replacements; no more six hand-edits.

---

## Genuine strengths (keep these)

Near-zero `any` (1 in 9.2k LOC); clean `api/ollama` isolation with correct SSE-frame + abort handling; sophisticated rolling-memory/distillation; Rust is `Result`-everywhere with `catch_unwind` around `pdf_extract`, strict loopback binding, and a real path allowlist; genuine unit-test discipline; and a written standards doc.

## Corrections to the raw audit

- Seed/Seraphina portraits are **bundled asset URLs**, not data-URLs (don't count toward quota).
- `emotion.ts` / `uiIcons.ts` / `tauri.ts` are **not** dead — all in use.
- The allowlist symlink TOCTOU is real but low-practical-risk (needs local FS write + timing); not a network risk.
