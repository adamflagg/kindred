// frontend/src/components/weekend/ShareRequestPanel.golden.test.tsx
/** Render-identical pin for kindred#2759's extract (PR A). See ShareMarks.golden.test.tsx. */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import { ShareRequestPanel } from './ShareRequestPanel'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return { grain: 'household', household_cm_id: 1000001, display_name: 'Johnson', ...overrides }
}

const CASES: ReadonlyArray<readonly [string, RosterPartyRow]> = [
  [
    'yes-cluster-and-blocks',
    party({
      share: {
        preference: 'yes_share',
        proximity: ['with', 'near'],
        wants_with_named: true,
        request_blocks: [
          {
            source_field: 'COVID-19 Bunking Requests',
            authorship: 'family',
            entries: [{ text: 'Liam Garcia and Olivia Chen', contributors: ['Emma Johnson'] }],
          },
          {
            source_field: 'Share Bunk With',
            authorship: 'family',
            entries: [{ text: 'The Chen family', contributors: [] }],
          },
          {
            source_field: 'Internal Bunk Notes',
            authorship: 'staff',
            entries: [{ text: 'Called 8/12, happy anywhere.', contributors: [] }],
          },
          {
            source_field: 'BunkingNotes Notes',
            authorship: 'staff',
            entries: [{ text: 'Returning family.', contributors: [] }],
          },
        ],
      },
    }),
  ],
  [
    'joined-fallback',
    party({ share: { preference: 'no_share', request_text: 'Near Riley Sam please' } }),
  ],
  ['unanswered-empty', party({ share: { preference: 'unknown' } })],
  ['person-grain', party({ grain: 'person', person_cm_id: 1000004 })],
]

describe('ShareRequestPanel — render-identical golden (kindred#2759 extract)', () => {
  it.each(CASES)('%s', async (name, row) => {
    const { container } = render(<ShareRequestPanel party={row} />)
    await expect(container.innerHTML).toMatchFileSnapshot(
      `./__golden__/share-request-panel.${name}.golden.txt`
    )
  })
})
