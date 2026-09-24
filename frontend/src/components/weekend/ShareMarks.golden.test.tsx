// frontend/src/components/weekend/ShareMarks.golden.test.tsx
/**
 * Render-identical pin for kindred#2759's extract (PR A). Recorded on main
 * BEFORE `MarkRun` existed; the refactor must reproduce it byte for byte.
 * Never regenerate these with `-u` inside the extract PR.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import { ShareMarks } from './ShareMarks'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return { grain: 'household', household_cm_id: 1000001, display_name: 'Johnson', ...overrides }
}

const CASES: ReadonlyArray<readonly [string, RosterPartyRow]> = [
  ['unanswered', party({ share: { preference: 'unknown' } })],
  ['no-share-near', party({ share: { preference: 'no_share', proximity: ['near'] } })],
  [
    'maybe-with-shared-request',
    party({
      share: {
        preference: 'maybe_mutual',
        request_blocks: [
          {
            source_field: 'Shared-request',
            authorship: 'family',
            entries: [{ text: 'Near the Garcia family', contributors: [] }],
          },
        ],
      },
    }),
  ],
  [
    'yes-three-capsule',
    party({
      share: {
        preference: 'yes_share',
        proximity: ['near', 'with', 'similar_ages'],
        wants_with_named: true,
        request_blocks: [
          {
            source_field: 'COVID-19 Bunking Requests',
            authorship: 'family',
            entries: [{ text: 'Liam Garcia', contributors: [] }],
          },
        ],
      },
    }),
  ],
  ['yes-near-only', party({ share: { preference: 'yes_share', proximity: ['near'] } })],
  ['person-grain', party({ grain: 'person', person_cm_id: 1000004 })],
]

describe('ShareMarks — render-identical golden (kindred#2759 extract)', () => {
  it.each(CASES)('%s', async (name, row) => {
    const { container } = render(<ShareMarks party={row} />)
    await expect(container.innerHTML).toMatchFileSnapshot(
      `./__golden__/share-marks.${name}.golden.txt`
    )
  })
})
