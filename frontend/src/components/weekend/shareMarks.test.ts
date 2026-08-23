/**
 * The truth table for the share-question mark vocabulary — spec
 * 2026-08-22 (`docs/plans/2026-08-22-share-icons-spec.md`, LOCAL ONLY,
 * the Share Icons Lab artifact `LOCKED-final-picks`).
 *
 * This file is the specification for `shareMarks.ts`. One `describe` per
 * numbered rule in the task-3 brief; `party()` builds a household-grain row
 * per the file convention (`needGlyphs.test.ts`) — no shared factory exists.
 *
 * Fictional data throughout.
 */
import { HeartHandshake, Milestone, UsersRound } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import type { RequestTextBlockRow, RosterPartyRow } from '../../types/lodging'
import {
  CAP_CLASSES,
  clusterCap,
  requestBlockText,
  resolveShareAnchor,
  resolveShareCluster,
} from './shareMarks'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return { grain: 'household', household_cm_id: 1000001, display_name: 'Johnson', ...overrides }
}

function block(overrides: Partial<RequestTextBlockRow> = {}): RequestTextBlockRow {
  return {
    source_field: 'COVID-19 Bunking Requests',
    authorship: 'family',
    entries: [{ text: 'the Garcia family', contributors: [] }],
    ...overrides,
  }
}

const namesBlock = (text: string) => ({
  source_field: 'COVID-19 Bunking Requests',
  authorship: 'family' as const,
  entries: [{ text, contributors: [] }],
})

const sharedRequestBlock = (text: string) => ({
  source_field: 'Shared-request',
  authorship: 'family' as const,
  entries: [{ text, contributors: [] }],
})

// ── Rule 1 ───────────────────────────────────────────────────────────────────

describe('rule 1 — grain guard: adult weekends render no share marks at all', () => {
  it('returns null / empty for a person-grain party', () => {
    // `share: undefined` is not assignable under `exactOptionalPropertyTypes`
    // (task-3-brief's sample snippet predates that check) — omitting the key
    // is the same runtime fact (`party.share === undefined`) and compiles.
    const p = party({ grain: 'person' })
    expect(resolveShareAnchor(p)).toBeNull()
    expect(resolveShareCluster(p)).toEqual([])
  })

  it('returns null / empty for a person-grain party even with a fully-answered share block', () => {
    const p = party({
      grain: 'person',
      person_cm_id: 5001,
      share: { preference: 'yes_share', proximity: ['with', 'near'], wants_with_named: true },
    })
    expect(resolveShareAnchor(p)).toBeNull()
    expect(resolveShareCluster(p)).toEqual([])
  })

  it('is on for a household-grain party with no share block at all', () => {
    const p = party()
    expect(resolveShareAnchor(p)).not.toBeNull()
    expect(resolveShareAnchor(p)?.state).toBe('unanswered')
  })
})

// ── Rule 2 ───────────────────────────────────────────────────────────────────

describe('rule 2 — the anchor is always on for a household, shade = the answer', () => {
  it('maps yes_share to the yes state', () => {
    const a = resolveShareAnchor(
      party({ share: { preference: 'yes_share', preference_raw: 'Yes, I would like to share…' } })
    )
    expect(a?.state).toBe('yes')
    expect(a?.className).toContain('bg-forest-100')
  })
  it('maps maybe_mutual to the maybe state', () => {
    const a = resolveShareAnchor(
      party({
        share: {
          preference: 'maybe_mutual',
          preference_raw: 'Maybe, if a specific family we know',
        },
      })
    )
    expect(a?.state).toBe('maybe')
  })
  it('maps no_share to the no state', () => {
    const a = resolveShareAnchor(
      party({ share: { preference: 'no_share', preference_raw: 'No, prefer not to share' } })
    )
    expect(a?.state).toBe('no')
  })
  it('maps unknown to the unanswered state', () => {
    const a = resolveShareAnchor(party({ share: { preference: 'unknown' } }))
    expect(a?.state).toBe('unanswered')
  })
  it('renders unanswered — dotted, never hidden — when the share block is silent', () => {
    const a = resolveShareAnchor(party({ share: { preference: 'unknown' } }))
    expect(a?.state).toBe('unanswered')
    expect(a?.className).toContain('border-dotted')
  })
  it('never hides the anchor for a household — a fully absent share block still resolves', () => {
    const a = resolveShareAnchor(party())
    expect(a).not.toBeNull()
    expect(a?.state).toBe('unanswered')
  })
})

// ── Rule 3 ───────────────────────────────────────────────────────────────────

describe('rule 3 — anchor tooltip: a fixed short prefix per state, never the verbatim sentence', () => {
  /*
   * Owner ruling 2026-08-22 (supersedes the spec's raw-sentence clause): staff
   * know the answer wordings, so the verbatim CampMinder sentence is noise.
   * The tooltip is `Yes, Share Cabin` / `Maybe Share Cabin` /
   * `Don't Share Cabin`, with `: <content>` appended only when the reg-form
   * Shared-request text exists. `preference_raw` renders nowhere.
   */
  it('renders the yes prefix, never the verbatim sentence', () => {
    const a = resolveShareAnchor(
      party({ share: { preference: 'yes_share', preference_raw: 'Yes, I would like to share…' } })
    )
    expect(a?.tooltip).toBe('Yes, Share Cabin')
  })
  it('renders the maybe prefix', () => {
    const a = resolveShareAnchor(
      party({
        share: { preference: 'maybe_mutual', preference_raw: 'Maybe, if a family we know…' },
      })
    )
    expect(a?.tooltip).toBe('Maybe Share Cabin')
  })
  it('renders the no prefix', () => {
    const a = resolveShareAnchor(party({ share: { preference: 'no_share' } }))
    expect(a?.tooltip).toBe("Don't Share Cabin")
  })
  it('keeps the self-explanatory unanswered sentence when the share block is silent', () => {
    const a = resolveShareAnchor(party({ share: { preference: 'unknown' } }))
    expect(a?.tooltip).toBe('Share question not answered')
  })

  describe('the conditional `: <content>` append — yes/maybe only, only when the reg-form text is non-empty', () => {
    it('appends to a yes tooltip when a family Shared-request block exists', () => {
      const a = resolveShareAnchor(
        party({
          share: {
            preference: 'yes_share',
            preference_raw: 'Yes, I would like to share…',
            request_blocks: [sharedRequestBlock('the Martinez family')],
          },
        })
      )
      expect(a?.tooltip).toBe('Yes, Share Cabin: the Martinez family')
    })
    it('appends to a maybe tooltip when a family Shared-request block exists', () => {
      const a = resolveShareAnchor(
        party({
          share: {
            preference: 'maybe_mutual',
            request_blocks: [sharedRequestBlock('the Nguyen family')],
          },
        })
      )
      expect(a?.tooltip).toBe('Maybe Share Cabin: the Nguyen family')
    })
    it('never appends for no, even with a Shared-request block present', () => {
      const a = resolveShareAnchor(
        party({
          share: {
            preference: 'no_share',
            request_blocks: [sharedRequestBlock('the Patel family')],
          },
        })
      )
      expect(a?.tooltip).toBe("Don't Share Cabin")
      expect(a?.tooltip).not.toContain(':')
    })
    it('never appends for unanswered, even with a Shared-request block present', () => {
      const a = resolveShareAnchor(
        party({
          share: {
            preference: 'unknown',
            request_blocks: [sharedRequestBlock('the Alvarez family')],
          },
        })
      )
      expect(a?.tooltip).toBe('Share question not answered')
      expect(a?.tooltip).not.toContain('Shared-request')
    })
    it('does not append when the Shared-request block is empty text', () => {
      const a = resolveShareAnchor(
        party({
          share: {
            preference: 'yes_share',
            preference_raw: 'Yes',
            request_blocks: [sharedRequestBlock('  ')],
          },
        })
      )
      expect(a?.tooltip).toBe('Yes, Share Cabin')
    })
    it('ignores a COVID-19 Bunking Requests block for the anchor append — Shared-request only', () => {
      const a = resolveShareAnchor(
        party({
          share: {
            preference: 'yes_share',
            preference_raw: 'Yes',
            request_blocks: [namesBlock('the Yoder family')],
          },
        })
      )
      expect(a?.tooltip).toBe('Yes, Share Cabin')
    })
  })
})

// ── Rule 4 ───────────────────────────────────────────────────────────────────

describe('rule 4 — the WITH-named mark keys on the un-ORed flag alone', () => {
  it('similar-age only (proximity carries the derived with superset) renders similar WITHOUT the WITH mark', () => {
    const marks = resolveShareCluster(
      party({ share: { proximity: ['with', 'similar_ages'], wants_with_named: false } })
    )
    expect(marks.map((m) => m.key)).toEqual(['similar_ages'])
  })
  it('the named tick renders the WITH mark', () => {
    const marks = resolveShareCluster(
      party({ share: { proximity: ['with'], wants_with_named: true } })
    )
    expect(marks.map((m) => m.key)).toEqual(['with'])
  })
  it('both ticks render both marks, WITH first, and NEAR always last', () => {
    const marks = resolveShareCluster(
      party({ share: { proximity: ['near', 'with', 'similar_ages'], wants_with_named: true } })
    )
    expect(marks.map((m) => m.key)).toEqual(['with', 'similar_ages', 'near'])
  })
  it('renders nothing when wants_with_named is absent and proximity is empty', () => {
    const marks = resolveShareCluster(party({ share: { preference: 'no_share' } }))
    expect(marks).toEqual([])
  })
  it('wants_with_named true with an empty proximity array still renders the WITH mark', () => {
    const marks = resolveShareCluster(party({ share: { proximity: [], wants_with_named: true } }))
    expect(marks.map((m) => m.key)).toEqual(['with'])
  })
})

// ── Rule 5 ───────────────────────────────────────────────────────────────────

describe('rule 5 — per-icon tooltips repeat the one names text', () => {
  it('prefixes the WITH shorthand onto the COVID-19 Bunking Requests family text', () => {
    const share = {
      proximity: [],
      wants_with_named: true,
      request_blocks: [namesBlock('the Garcia family')],
    }
    const [withMark] = resolveShareCluster(party({ share }))
    expect(withMark?.tooltip).toBe('Share with family: the Garcia family')
  })
  it('prefixes the similar-age shorthand onto the same text', () => {
    const share = {
      proximity: ['similar_ages' as const],
      request_blocks: [namesBlock('the Garcia family')],
    }
    const [similar] = resolveShareCluster(party({ share }))
    expect(similar?.tooltip).toBe('Similar age kids: the Garcia family')
  })
  it('prefixes each shorthand onto the COVID-19 Bunking Requests family text', () => {
    const share = {
      proximity: ['near' as const],
      request_blocks: [namesBlock('the Garcia family')],
    }
    const [near] = resolveShareCluster(party({ share }))
    expect(near?.tooltip).toBe('Near family: the Garcia family')
  })
  it('leaves the shorthand alone when the text is empty', () => {
    const [near] = resolveShareCluster(party({ share: { proximity: ['near'] } }))
    expect(near?.tooltip).toBe('Near family')
  })
  it('the same text repeats verbatim under every icon when all three ticks fire', () => {
    const share = {
      proximity: ['near' as const, 'similar_ages' as const],
      wants_with_named: true,
      request_blocks: [namesBlock('the Garcia family')],
    }
    const marks = resolveShareCluster(party({ share }))
    expect(marks.map((m) => m.tooltip)).toEqual([
      'Share with family: the Garcia family',
      'Similar age kids: the Garcia family',
      'Near family: the Garcia family',
    ])
  })
  it('ignores a Shared-request block for the cluster tooltip — COVID-19 Bunking Requests only', () => {
    const share = {
      proximity: ['near' as const],
      request_blocks: [sharedRequestBlock('the Martinez family')],
    }
    const [near] = resolveShareCluster(party({ share }))
    expect(near?.tooltip).toBe('Near family')
  })
})

// ── Rule 6 ───────────────────────────────────────────────────────────────────

describe('rule 6 — requestBlockText', () => {
  it('joins two non-blank entries with "; "', () => {
    const share = {
      request_blocks: [
        block({
          entries: [
            { text: 'the Garcia family', contributors: [] },
            { text: 'the Nguyen family', contributors: [] },
          ],
        }),
      ],
    }
    expect(requestBlockText(share, 'COVID-19 Bunking Requests')).toBe(
      'the Garcia family; the Nguyen family'
    )
  })
  it('trims each entry and drops blank ones before joining', () => {
    const share = {
      request_blocks: [
        block({
          entries: [
            { text: '  the Garcia family  ', contributors: [] },
            { text: '   ', contributors: [] },
            { text: 'the Nguyen family', contributors: [] },
          ],
        }),
      ],
    }
    expect(requestBlockText(share, 'COVID-19 Bunking Requests')).toBe(
      'the Garcia family; the Nguyen family'
    )
  })
  it('skips a staff-authored block for the same source field', () => {
    const share = {
      request_blocks: [
        block({ authorship: 'staff', entries: [{ text: 'staff note', contributors: [] }] }),
      ],
    }
    expect(requestBlockText(share, 'COVID-19 Bunking Requests')).toBe('')
  })
  it('skips a block from a different source field', () => {
    const share = { request_blocks: [sharedRequestBlock('the Martinez family')] }
    expect(requestBlockText(share, 'COVID-19 Bunking Requests')).toBe('')
  })
  it('returns "" when request_blocks is absent', () => {
    expect(requestBlockText({}, 'COVID-19 Bunking Requests')).toBe('')
  })
  it('returns "" when share itself is undefined', () => {
    expect(requestBlockText(undefined, 'COVID-19 Bunking Requests')).toBe('')
  })
})

// ── Rule 7 ───────────────────────────────────────────────────────────────────

describe('rule 7 — caps come from the list, never CSS tree position (the half-pill trap)', () => {
  it('solo / left / middle / right', () => {
    expect(clusterCap(0, 1)).toBe('solo')
    expect(clusterCap(0, 3)).toBe('left')
    expect(clusterCap(1, 3)).toBe('middle')
    expect(clusterCap(2, 3)).toBe('right')
  })
  it('a two-mark list caps left and right with no middle', () => {
    expect(clusterCap(0, 2)).toBe('left')
    expect(clusterCap(1, 2)).toBe('right')
  })
  it('CAP_CLASSES carries the exact treatment for every cap', () => {
    expect(CAP_CLASSES.solo).toBe('rounded-full')
    expect(CAP_CLASSES.left).toBe('rounded-l-full rounded-r-none')
    expect(CAP_CLASSES.right).toBe('rounded-r-full rounded-l-none -ml-px')
    expect(CAP_CLASSES.middle).toBe('rounded-none -ml-px')
  })
})

// ── Rule 8 ───────────────────────────────────────────────────────────────────

describe('rule 8 — treatments (Tailwind, from the locked artifact tokens)', () => {
  it('anchor yes takes the forest treatment', () => {
    const a = resolveShareAnchor(party({ share: { preference: 'yes_share' } }))
    expect(a?.className).toBe(
      'bg-forest-100 text-forest-800 dark:bg-forest-950/50 dark:text-forest-300'
    )
  })
  it('anchor maybe takes the amber treatment', () => {
    const a = resolveShareAnchor(party({ share: { preference: 'maybe_mutual' } }))
    expect(a?.className).toBe(
      'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
    )
  })
  it('anchor no takes the quiet-gray bg-muted treatment, never red', () => {
    const a = resolveShareAnchor(party({ share: { preference: 'no_share' } }))
    expect(a?.className).toBe('bg-muted text-muted-foreground')
  })
  it('anchor unanswered takes the dotted no-fill treatment', () => {
    const a = resolveShareAnchor(party({ share: { preference: 'unknown' } }))
    expect(a?.className).toBe(
      'border border-dotted border-muted-foreground/60 text-muted-foreground/70'
    )
  })
  it('the WITH mark takes the forest (good-candidate) treatment', () => {
    const [withMark] = resolveShareCluster(
      party({ share: { proximity: [], wants_with_named: true } })
    )
    expect(withMark?.className).toBe(
      'bg-forest-100 text-forest-800 dark:bg-forest-950/50 dark:text-forest-300'
    )
  })
  it('the similar_ages mark takes the same forest treatment', () => {
    const [similar] = resolveShareCluster(party({ share: { proximity: ['similar_ages'] } }))
    expect(similar?.className).toBe(
      'bg-forest-100 text-forest-800 dark:bg-forest-950/50 dark:text-forest-300'
    )
  })
  it('the NEAR mark takes the indigo treatment — proximity, not sharing', () => {
    const [near] = resolveShareCluster(party({ share: { proximity: ['near'] } }))
    expect(near?.className).toBe(
      'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400'
    )
    expect(near?.className).toContain('text-indigo-600')
  })
})

// ── Rule 9 ───────────────────────────────────────────────────────────────────

describe('rule 9 — icons (lucide, LOCKED)', () => {
  // `ShareAnchorSpec` carries no `Icon` field (see the Interfaces block) — the
  // anchor draws `Handshake` fixed for every state, in Task 4's JSX, so
  // there is nothing of this module's shape to pin for it here. Only the
  // per-mark icons are part of `resolveShareCluster`'s output.
  it('the WITH mark draws HeartHandshake', () => {
    const [withMark] = resolveShareCluster(
      party({ share: { proximity: [], wants_with_named: true } })
    )
    expect(withMark?.Icon).toBe(HeartHandshake)
  })
  it('the similar_ages mark draws UsersRound', () => {
    const [similar] = resolveShareCluster(party({ share: { proximity: ['similar_ages'] } }))
    expect(similar?.Icon).toBe(UsersRound)
  })
  it('the NEAR mark draws Milestone', () => {
    const [near] = resolveShareCluster(party({ share: { proximity: ['near'] } }))
    expect(near?.Icon).toBe(Milestone)
  })
})

// ── Rule 10 ──────────────────────────────────────────────────────────────────

describe('rule 10 — aria-labels (test handles per the a11y policy, not accessibility)', () => {
  // Controller ruling 2026-08-22: the aria-label composition is
  // `Share: ${CHIP label}` — SharePreferenceChip's own wording, NOT rule 3's
  // tooltip fallback. The two coincide for yes/maybe/no; only `unanswered`
  // differs (`'Not answered'` here vs. the tooltip's self-explanatory
  // `'Share question not answered'`, asserted separately in rule 3 above).
  it('anchor aria-label is "Share: " plus the CHIP label, even when a raw tooltip sentence is present', () => {
    const a = resolveShareAnchor(
      party({ share: { preference: 'yes_share', preference_raw: 'Yes, I would like to share…' } })
    )
    expect(a?.ariaLabel).toBe('Share: Open to sharing')
  })
  it('anchor aria-label for maybe', () => {
    const a = resolveShareAnchor(party({ share: { preference: 'maybe_mutual' } }))
    expect(a?.ariaLabel).toBe('Share: Only if mutual')
  })
  it('anchor aria-label for no', () => {
    const a = resolveShareAnchor(party({ share: { preference: 'no_share' } }))
    expect(a?.ariaLabel).toBe('Share: Will not share')
  })
  it('anchor aria-label for unanswered matches SharePreferenceChip CHIP wording, not the tooltip fallback', () => {
    const a = resolveShareAnchor(party({ share: { preference: 'unknown' } }))
    expect(a?.ariaLabel).toBe('Share: Not answered')
    expect(a?.tooltip).toBe('Share question not answered')
  })
  it('mark aria-labels are the bare shorthand, regardless of tooltip text', () => {
    const share = {
      proximity: ['near' as const, 'similar_ages' as const],
      wants_with_named: true,
      request_blocks: [namesBlock('the Garcia family')],
    }
    const marks = resolveShareCluster(party({ share }))
    expect(marks.map((m) => m.ariaLabel)).toEqual([
      'Share with family',
      'Similar age kids',
      'Near family',
    ])
  })
})
