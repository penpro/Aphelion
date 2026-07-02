# The Portrait Engine — design & trainability

The live-portrait system is graduating from a feature into an engine: a trainable,
inspectable, multi-axis expression matcher that picks the right art for the moment.
This doc is its spec. Read it (and CHARACTER-REALISM.md) before changing the picker,
the tracker, or the Analyze pipeline.

## Why multi-axis (the "intense ≠ angry" problem)

Categorical labels (our 8: neutral/happy/sad/angry/…) can't distinguish *intense*
from *angry* — both read as "fierce face." Affective-computing research solved this
decades ago with **dimensional models**: an emotion is a point in continuous space,
not a bucket.

We use the **PAD model** (Mehrabian & Russell; the 3-axis extension of Russell's
circumplex), renamed for LLM clarity:

| Axis | 0 ←————————→ 100 | What it separates |
|------|------------------|-------------------|
| **pleasure** (valence) | miserable ↔ delighted | anger (low) vs. intensity (mid) vs. joy (high) |
| **energy** (arousal) | calm ↔ charged | serene warmth vs. excited warmth |
| **dominance** | submissive ↔ commanding | fear (low) vs. anger/confidence (high) |

The failure case, solved dimensionally: *anger* ≈ (pleasure 15, energy 80, dominance 75);
*intense/commanding* ≈ (pleasure 50, energy 80, dominance 80). Same energy, same
dominance — **only pleasure separates them**, and now the system has that axis.

We keep the 8 categorical labels too (they drive deterministic portrait sets and are
human-legible) — the hybrid discrete+continuous approach is standard practice in the
field (e.g. AffectNet-style datasets annotate both).

## Data model

```
PortraitIndexEntry {
  file: string
  tags: string                 // color-first keywords from Analyze (vision)
  expression?: { pleasure, energy, dominance }   // PAD of the FACE, rated at Analyze time
}
Character.tagBias?: Record<string, number>   // tag → −100..100, learned from user feedback
Chat.expression?: { pleasure, energy, dominance } // PAD of the MOMENT, from the turn tracker
```

## The per-reply flow

```
reply finishes
  → trackTurn: scene Δ + stats Δ + expression (PAD of the moment)
  → rankPortraits (one text call):
      inputs:  portrait index (tags + per-image PAD) · scene state · moment PAD ·
               current portrait (sticky) · trained bias (AVOID / FAVOR tag lists)
      rules:   1 EXPRESSION AXES (match PAD; anger requires LOW pleasure)
               2 OUTFIT (exact color/type + plausible for the setting)
               3 DETAILS   4 POSE (dead last)
      output:  ranked top-3 files + the tags that DROVE the choice
  → portrait shows rank #1; inspector holds the alternates + drivers
```

## Trainability (deliberately NOT a prediction model)

Per Wes's call: the LLM does the judging; the user's feedback just *re-weights the
evidence* it sees. All signals are per-character, persisted, and human-inspectable:

- **👍 on a pick** → +10 bias to each tag that drove it
- **👎 on a pick** → −15 to each driving tag ("cools them off"), and the portrait
  advances to the next-ranked alternate immediately
- **Demote a tag** (click its chip in the inspector) → −25
- **Add a tag** → appended to that portrait's index entry (user tags are evidence too)
- Bias ≤ −30 ⇒ the tag is listed under **AVOID** in the picker prompt ("do not let
  these drive the choice"); bias ≥ +30 ⇒ listed under **FAVOR**. The tag list itself
  is never hidden — the model sees everything, weighted, and stays explainable.

## The inspector (the pull-out tab)

A slim tab on the live-portrait stage slides out a panel showing: the chosen file,
the **driving tags** (why THIS one), 👍/👎, every tag as a clickable chip (click =
demote), an add-tag input, the moment's PAD vs. the portrait's PAD, and ◂ ▸ to cycle
through the ranked alternates (cycling is sticky — the picker respects your override
as the new current portrait).

## Art-prompt generation: basic vs. advanced

- **Basic** (existing): the deterministic 8-emotion prompt set — same appearance
  block, one prompt per label. Right for quick sets.
- **Advanced** (new): one model call that reads the character's description,
  personality, and the set name, then writes a *character-specific* expression range
  (12–16 prompts): a wry guarded character gets "guarded amusement — one brow raised,
  mouth fighting a smirk" instead of a generic "happy," each prompt annotated with its
  PAD target so the analyzed index lands where the picker expects it.

## Roadmap

1. ✅ v0.1.47 — everything above.
2. Feedback memory beyond tags: per-portrait cooldown (a file that keeps getting 👎
   in similar moments gets its own note in the prompt).
3. Auto-tuning from cycling: choosing alternate #3 over #1 is implicit feedback —
   treat as a soft 👎 on #1's drivers.
4. Expression interpolation: when no portrait is within a PAD radius, prefer the
   neutral-adjacent one over a wrong-quadrant match.
5. Export/import of a character's trained bias with the character card (the trained
   engine travels with the character — the sellable artifact).

## Research grounding

- Russell's circumplex model & the PAD (pleasure–arousal–dominance) extension —
  the standard dimensional emotion framework.
- Dimensional affect estimation in face analysis (continuous valence/arousal
  prediction) and hybrid discrete+continuous emotion detection.

Sources: [VAD model explainer (Valstar)](https://www.linkedin.com/pulse/dimensional-affect-explainer-valence-arousal-vad-michel-valstar-i10ye),
[PAD/dimensional models survey](https://arxiv.org/pdf/2203.06935),
[Bridging discrete & continuous emotion detection](https://arxiv.org/html/2409.07901v1),
[VAD across basic emotions](https://www.researchgate.net/figure/The-VAD-Valence-Arousal-Dominance-model-spanned-across-the-six-basic-emotions_fig1_338118399)
