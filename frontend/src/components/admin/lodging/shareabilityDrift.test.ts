/**
 * The classification is derived ONCE and then owned by a human, so its inputs
 * can move out from under it. This is the advisory that says so.
 *
 * The dangerous direction is `shareable` outliving a capacity correction: a
 * staffer fixing a cabin from `sleeps: 15` to `sleeps: 8` leaves the unit
 * marked shareable, and the board goes on showing an affirmative "Shared OK"
 * chip inviting a second household into a room the rule now says holds one —
 * the exact double-booking kindred#2026 exists to prevent, endorsed.
 *
 * Advisory only, with no "apply" button, for the same reason `capacityFlag`'s
 * conflict branch has none: the classification is a human ruling and this file
 * does not get to overturn it. It states the disagreement and asks nothing.
 */
import { describe, expect, it } from 'vitest'

import { shareabilityDrift } from './shareabilityDrift'

const base = {
  inventoryClass: 'family_pool',
  isContainer: false,
  sleeps: '15',
  stored: 'shareable',
} as const

describe('shareabilityDrift', () => {
  it('is silent when the stored classification still matches the rule', () => {
    expect(shareabilityDrift(base)).toBeNull()
  })

  it('flags a shareable unit whose capacity has dropped below the threshold', () => {
    // THE case this exists for, and the only one where staying silent would
    // leave a green chip endorsing a double-booking.
    const drift = shareabilityDrift({ ...base, sleeps: '8' })
    expect(drift?.stored).toBe('shareable')
    expect(drift?.derived).toBe('single_party')
  })

  it('flags the conservative direction too, so a cabin is not left under-used', () => {
    const drift = shareabilityDrift({ ...base, sleeps: '15', stored: 'single_party' })
    expect(drift?.stored).toBe('single_party')
    expect(drift?.derived).toBe('shareable')
  })

  it('flags a unit moved to staff housing while still marked shareable', () => {
    const drift = shareabilityDrift({ ...base, inventoryClass: 'staff_default' })
    expect(drift?.derived).toBe('single_party')
  })

  it('flags a room promoted to a container while still marked one-family', () => {
    const drift = shareabilityDrift({ ...base, isContainer: true, stored: 'single_party' })
    expect(drift?.derived).toBe('shareable')
  })

  it('says nothing on an UNCLASSIFIED unit', () => {
    // '' is not a wrong answer that drifted, it is the absence of one. The
    // board already badges it "Sharing unset"; a second nag in the form for a
    // staffer who has not answered yet would train them to dismiss this.
    expect(shareabilityDrift({ ...base, stored: '' })).toBeNull()
    expect(shareabilityDrift({ ...base, sleeps: '8', stored: '' })).toBeNull()
  })

  it('says nothing when capacity is unknown, rather than guessing', () => {
    // Blank sleeps is UNKNOWN. The rule declines to classify an unmeasured
    // leaf, so it has no derived answer to disagree with, and asserting drift
    // off a missing number is exactly the guess the select exists to refuse.
    expect(shareabilityDrift({ ...base, sleeps: '' })).toBeNull()
    expect(shareabilityDrift({ ...base, sleeps: '0' })).toBeNull()
  })

  it('says nothing when the role is unrecorded', () => {
    expect(shareabilityDrift({ ...base, inventoryClass: '' })).toBeNull()
  })

  it('ignores capacity entirely on a container, as the rule does', () => {
    // A container's `sleeps` is a DELTA over its rooms (kindred#2041), so a
    // small number on one is not evidence of anything. A shareable container
    // must not be nagged about its delta.
    expect(shareabilityDrift({ ...base, isContainer: true, sleeps: '1' })).toBeNull()
    expect(shareabilityDrift({ ...base, isContainer: true, sleeps: '' })).toBeNull()
  })
})
