import { describe, it, expect, vi } from 'vitest'
import { migrateCharacterPortraits, collectDiskRefs } from './portraits'
import type { Character } from './types'

const char = (partial: Partial<Character>): Character => ({
  id: 'c1',
  name: 'Mara',
  avatar: '🙂',
  color: '#7c5cff',
  description: '',
  personality: '',
  scenario: '',
  exampleDialogue: '',
  systemPrompt: '',
  createdAt: 1,
  ...partial,
})

const PNG = 'data:image/png;base64,AAAA'
const WEBP = 'data:image/webp;base64,BBBB'
const SVG = 'data:image/svg+xml,%3Csvg%3E' // generic orb portraits — must stay inline
const ASSET = '/assets/seraphina/neutral-abc.webp' // bundled import — must stay untouched
const DISK = 'disk:C:/app/portraits/x.webp'

// A persist stub that "writes" any data-URL to disk deterministically.
const fakePersist = (v: string) => Promise.resolve('disk:/p/' + v.slice(11, 14))

describe('migrateCharacterPortraits', () => {
  it('moves real image data-URLs from all three fields and leaves everything else alone', async () => {
    const c = char({
      portrait: PNG,
      portraits: { happy: WEBP, sad: SVG },
      portraitSets: [
        { id: 's1', name: 'A', portraits: { neutral: PNG, angry: DISK } },
        { id: 's2', name: 'B', portraits: { happy: ASSET } },
      ],
    })
    const patch = await migrateCharacterPortraits(c, fakePersist)
    expect(patch).not.toBeNull()
    expect(patch!.portrait).toBe('disk:/p/png')
    expect(patch!.portraits).toEqual({ happy: 'disk:/p/web', sad: SVG }) // svg untouched
    expect(patch!.portraitSets![0].portraits).toEqual({ neutral: 'disk:/p/png', angry: DISK })
    expect(patch!.portraitSets![1].portraits).toEqual({ happy: ASSET }) // bundled asset untouched
  })

  it('returns null when there is nothing to move', async () => {
    const persist = vi.fn()
    const c = char({ portrait: SVG, portraits: { happy: DISK }, portraitSets: [{ id: 's', name: 'A', portraits: { sad: ASSET } }] })
    expect(await migrateCharacterPortraits(c, persist)).toBeNull()
    expect(persist).not.toHaveBeenCalled()
  })

  it('returns null when the disk write fails (persist echoes its input) — retried next boot', async () => {
    const c = char({ portrait: PNG })
    expect(await migrateCharacterPortraits(c, (v) => Promise.resolve(v))).toBeNull()
  })

  it('patches only the fields that actually changed', async () => {
    const c = char({ portrait: DISK, portraits: { happy: PNG } })
    const patch = await migrateCharacterPortraits(c, fakePersist)
    expect(patch).not.toBeNull()
    expect('portrait' in patch!).toBe(false)
    expect(patch!.portraits).toEqual({ happy: 'disk:/p/png' })
  })
})

describe('collectDiskRefs', () => {
  it('gathers disk refs from the face portrait, the legacy set, and named sets — nothing else', () => {
    const c = char({
      portrait: DISK,
      portraits: { happy: PNG, sad: 'disk:/p/legacy.webp' },
      portraitSets: [{ id: 's', name: 'A', portraits: { neutral: 'disk:/p/set.webp', angry: ASSET } }],
    })
    expect(collectDiskRefs(c).sort()).toEqual([DISK, 'disk:/p/legacy.webp', 'disk:/p/set.webp'].sort())
  })

  it('returns empty for a character with no disk refs', () => {
    expect(collectDiskRefs(char({ portrait: PNG }))).toEqual([])
  })
})
