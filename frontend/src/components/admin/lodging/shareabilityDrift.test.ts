/**
 * The classification is derived ONCE and then owned by a human, so its inputs
 * can move out from under it. This is the advisory that says so.
 *
 * RETIRED, kindred#2331 (owner ruling D17, 2026-08-14): the LEAF comparison.
 * `shareability` on a family_pool leaf used to be derived from `sleeps >= 12`
 * — a threshold no leaf in the inventory ever reached, so it never matched the
 * owner's actual multi-family enumeration. It is now a CURATED registry fact
 * (`config/lodging_registry.json`'s per-unit `shareability` key,
 * `pocketbase/lodging/registry.go`'s `classifyShareability`), not something
 * this file can re-derive from form fields at all. Comparing `stored` against
 * a `sleeps` threshold that no longer governs anything would warn on every
 * staff correction that curated a small cabin shareable — the exact "every
 * staff correction warns forever" failure kindred#2331 exists to close.
 *
 * The CONTAINER and staff_default legs are UNCHANGED: both are still real,
 * live-computable rules (container-ness, and the housing role), not curated
 * facts, so there is still something honest to compare `stored` against.
 *
 * The dangerous direction, for what remains, is `shareable` outliving a role
 * change: a cabin moved from family_pool to staff_default stays marked
 * shareable, and the board goes on showing an affirmative "Shared OK" chip on
 * a room that is no longer family-camp inventory at all.
 *
 * Advisory only, with no "apply" button, for the same reason `capacityFlag`'s
 * conflict branch has none: the classification is a human ruling and this file
 * does not get to overturn it. It states the disagreement and asks nothing.
 */
import { describe, expect, it } from 'vitest'

import { shareabilityDrift } from './shareabilityDrift'

const leafBase = {
  inventoryClass: 'family_pool',
  isContainer: false,
  sleeps: '15',
  stored: 'shareable',
} as const

describe('shareabilityDrift', () => {
  describe('a LEAF (retired comparison)', () => {
    it('says nothing for a curated-shareable leaf, whatever sleeps reads', () => {
      // THE case kindred#2331 exists to fix: a leaf staff curated shareable
      // at any capacity must never be nagged back toward single_party by a
      // `sleeps` number the rule no longer consults.
      expect(shareabilityDrift(leafBase)).toBeNull()
      expect(shareabilityDrift({ ...leafBase, sleeps: '4' })).toBeNull()
      expect(shareabilityDrift({ ...leafBase, sleeps: '' })).toBeNull()
    })

    it('says nothing for a curated-single_party leaf, whatever sleeps reads', () => {
      expect(shareabilityDrift({ ...leafBase, stored: 'single_party', sleeps: '15' })).toBeNull()
      expect(shareabilityDrift({ ...leafBase, stored: 'single_party', sleeps: '' })).toBeNull()
    })

    it('says nothing on an UNCLASSIFIED leaf', () => {
      // '' is not a wrong answer that drifted, it is the absence of one. The
      // board already badges it "Sharing unset"; a second nag in the form for
      // a staffer who has not answered yet would train them to dismiss this.
      expect(shareabilityDrift({ ...leafBase, stored: '' })).toBeNull()
    })
  })

  describe('a CONTAINER (unchanged rule)', () => {
    it('flags a room promoted to a container while still marked one-family', () => {
      const drift = shareabilityDrift({ ...leafBase, isContainer: true, stored: 'single_party' })
      expect(drift?.stored).toBe('single_party')
      expect(drift?.derived).toBe('shareable')
    })

    it('ignores capacity entirely on a container, as the rule does', () => {
      // A container's `sleeps` is a DELTA over its rooms (kindred#2041), so a
      // small number on one is not evidence of anything. A shareable
      // container must not be nagged about its delta.
      expect(shareabilityDrift({ ...leafBase, isContainer: true, sleeps: '1' })).toBeNull()
      expect(shareabilityDrift({ ...leafBase, isContainer: true, sleeps: '' })).toBeNull()
    })
  })

  describe('staff_default (unchanged rule)', () => {
    it('flags a unit moved to staff housing while still marked shareable', () => {
      const drift = shareabilityDrift({ ...leafBase, inventoryClass: 'staff_default' })
      expect(drift?.stored).toBe('shareable')
      expect(drift?.derived).toBe('single_party')
    })

    it('says nothing when the stored value already matches staff_default', () => {
      expect(
        shareabilityDrift({ ...leafBase, inventoryClass: 'staff_default', stored: 'single_party' })
      ).toBeNull()
    })
  })

  it('says nothing when the role is unrecorded', () => {
    expect(shareabilityDrift({ ...leafBase, inventoryClass: '' })).toBeNull()
  })
})
