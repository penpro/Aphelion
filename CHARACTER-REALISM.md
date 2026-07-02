# Character Realism — the goal and the levers

This is the standing quality bar for Aphelion's character interactions, and the working
document for refining them. Read it before touching the roleplay prompt stack
(`prompt.ts`, `api/classifiers.ts`, `useGeneration.ts`) — every change should move toward
THE GOAL below, and every regression against it is a bug even if nothing crashes.

---

## THE GOAL (the standing prompt)

> Refine Aphelion's character interactions until the characters read as **real people with
> their own interiority** — not as an improviser eagerly playing along.
>
> A real person: **wants things** independently of what the user wants; **remembers** what
> was said, promised, and done to them; **changes gradually** — moods shift with cause,
> trust and intimacy are built, not granted; **filters what they show** through who they
> are (a guarded person hides warmth; a proud person hides hurt); **can say no** — and
> their yes means something *because* their no was possible; and **cannot be authored by
> the other party** — nothing about them is true until they do it on the page.
>
> An improviser (the failure mode): accepts every offer ("yes, and—"); mirrors the user's
> tone and desire instead of having their own; teleports emotionally to wherever the scene
> seems to want them; complies with stage directions written *about* them; escalates
> intimacy on request rather than through earned beats; and performs their personality as
> a costume of verbal tics instead of letting it govern their decisions.
>
> When evaluating any transcript, ask one question: **"did the character do that because
> of who they are and what has actually happened — or because the user asked?"** Every
> answer of "because the user asked" that wasn't genuinely earned is the defect to fix.

---

## Failure modes → the lever that fixes each

| # | Failure mode | What it looks like | Lever |
|---|--------------|--------------------|-------|
| 1 | **Puppeting** | User writes "Anya takes off her clothes" and it simply becomes true | **Earned actions** toggle (`Chat.autonomy` → `autonomyBlock`): user prose authors only the user; character actions are wishes until the character does them |
| 2 | **Mood teleportation** | Furious one line, flirty the next, with no cause | **Character stats** (`Chat.characterStats` → `statsBlock`): ten 0-100 levers, moved gradually by the tracker, injected every turn |
| 3 | **Unearned intimacy** | Stranger → devoted lover in three messages | Stats again — arousal/affection/trust must climb through events; "high levels must be EARNED" is in the injection |
| 4 | **Tone-deaf surface reads** | Wry/guarded/flirty prose read as "angry" | Subtext-first classification everywhere (emotion classifier, tracker) + **openness/trust** levers: true feelings vs. what's shown |
| 5 | **Scene amnesia** | The red dress vanishes; the knife she drew is forgotten | **Scene state** (`Chat.sceneState` → `sceneStateBlock`): outfit/hair/pose/props/location carried and injected |
| 6 | **Story amnesia** | Promises, grudges, and revelations evaporate | Rolling memory (`summary` + distillation) — predates this effort; extend it toward *relationship* facts (see backlog) |
| 7 | **Improv-actor voice** | "Playing along with a game" energy; personality as tics | The stats display rule ("what they SHOW is filtered through personality") + character card quality; probe-test it |
| 8 | **User-mirroring** | The character wants whatever the user wants | Backlog: a carried **wants/agenda** line (their own goal each scene) |

All levers are per-chat, visible, and editable in the chat dials — a wrong state is a
two-second manual fix, and manual edits are authoritative for the next turn.

## How the pieces connect (one loop per reply)

```
reply finishes
  → trackTurn (one deterministic call): scene Δ + stats Δ
      · character's own reply is ground truth; user claims don't count unconfirmed
      · stats move gradually; colors mandatory in scene fields
  → injected into the NEXT system prompt (sceneStateBlock + statsBlock [+ autonomyBlock])
  → live portrait queries the same state (exact colors/pose/mood, not prose vibes)
  → user can inspect/override everything in the dials
```

## Probe tests (run after any prompt-stack change)

Use a guarded, wry character (Anya-type) unless noted. Pass = the starred behavior.

1. **The puppet probe** (autonomy ON): write *"Anya takes off her clothes."*
   ★ She does NOT simply comply — she responds to it as a request/wish, in character
   (deflect, tease, refuse, or comply *only if* the stats/story have earned it).
2. **The teleport probe**: after a tense argument scene, write something charming.
   ★ Anger/trust move a step, not a cliff — she thaws gradually; the stats panel shows
   a small shift, not 80→5.
3. **The instant-intimacy probe**: on message 2 of a new chat, invite her to bed.
   ★ Declined or deflected in character; arousal/affection/trust visibly low in dials.
4. **The subtext probe**: play out dry, sharp-tongued flirting for several turns.
   ★ Portrait/emotion reads affectionate-ish, not angry; openness stays low while
   affection climbs — the "hidden, not absent" behavior.
5. **The wardrobe probe**: "go put on the black lingerie" (with a smart-portrait folder).
   ★ Scene state outfit updates with the exact color; the portrait matches; a later
   vague prompt ("put on green") does NOT flip anything until the story confirms it.
6. **The continuity probe**: establish a prop (a knife, a letter), chat 10+ turns about
   other things, then reference it obliquely.
   ★ Still in `props`/memory; she doesn't contradict it.
7. **The no-means-something probe** (autonomy ON): push twice on something she refused.
   ★ Consistent refusal or a *negotiated* shift with visible stat movement — not sudden
   capitulation. (Content itself is governed by the intensity dial, not by pestering.)

## Refinement loop

1. Wes plays; saves/exports the transcript of anything that felt fake.
2. Identify WHICH failure mode (table above) — trace it to the lever that should have
   caught it (check the dials: were the stats wrong, or right-but-ignored?).
3. Fix at the right layer: tracker prompt (state wrong) → injection wording (state right,
   behavior wrong) → UI/defaults (right thing too hidden) → new lever (nothing covers it).
4. Re-run the probe tests above. Ship. Update this doc if the levers changed.

## Backlog (next levers, in rough order)

- **Wants/agenda line**: one carried sentence of what the character currently wants in the
  scene, updated by the tracker, injected — the direct anti-mirroring lever (#8).
- **Per-character stat baselines**: seed stats from the character card at chat start
  (a dominatrix doesn't start at confidence 50) instead of neutral defaults.
- **Relationship ledger**: extend rolling memory with a small structured record of
  promises, grudges, secrets known, and firsts — the durable version of #6.
- **Refusal memory**: things the character has declined, carried so pestering shows as
  pattern ("you keep asking") instead of resetting each turn.
- **Group-chat stats**: today scene/stats track the PRIMARY character only; per-cast-member
  tracking is a cost/UX question (N small calls per reply).
- **Stat-aware intensity**: optionally gate the intensity dial's ceiling behind earned
  arousal/trust so "explicit" still requires the story to get there.
