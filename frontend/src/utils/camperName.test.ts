/**
 * The conflict-dialog name fallback, extracted from the two call sites that
 * had it duplicated (`LockGroupContext`, `LockGroupActionBar`).
 *
 * The whole point of this helper is the operator. Both fields carry `''`
 * rather than `undefined` when absent -- `transforms.ts` writes
 * `first_name: person.first_name || ''`, and PocketBase zero-values scalars
 * rather than omitting them -- so `??` never falls through and the dialog
 * renders a blank name. Same class as `weekend/partyKey.ts` (#2669).
 *
 * Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import { resolveCamperName } from './camperName'

describe('resolveCamperName', () => {
  it('uses the full name when it is present', () => {
    expect(resolveCamperName({ name: 'Emma Johnson', first_name: 'Emma' })).toBe('Emma Johnson')
  })

  it('falls through an EMPTY full name to the first name', () => {
    // `??` would stop here and return '' -- this is the bug being fixed.
    expect(resolveCamperName({ name: '', first_name: 'Emma' })).toBe('Emma')
  })

  it('falls through to "Camper" when both are empty strings', () => {
    expect(resolveCamperName({ name: '', first_name: '' })).toBe('Camper')
  })

  it('falls through to "Camper" when first_name is absent entirely', () => {
    expect(resolveCamperName({ name: '' })).toBe('Camper')
  })
})
