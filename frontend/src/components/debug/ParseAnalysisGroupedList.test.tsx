import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { ParseAnalysisGroupedList } from './ParseAnalysisGroupedList'
import type { CamperGroupedRequests } from './types'

const campers: CamperGroupedRequests[] = [
  {
    requester_cm_id: 1001,
    requester_name: 'Emma Johnson',
    fields: [
      {
        original_request_id: 'req-1',
        source_field: 'bunk_request_form',
        original_text: 'Please bunk with Sofia',
        has_debug_result: false,
        has_production_result: true,
      },
    ],
  },
  {
    requester_cm_id: 1002,
    requester_name: 'Liam Garcia',
    fields: [],
  },
]

function baseProps() {
  return {
    items: campers,
    isLoading: false,
    reparsingCmIds: new Set<number>(),
    clearingCmIds: new Set<number>(),
    onReparseCamper: vi.fn(),
    onClearCamper: vi.fn(),
    searchQuery: '',
    selectedCamperCmId: null,
    onCamperSelect: vi.fn(),
  }
}

// Camper selection used to live on a click handler on a non-interactive
// `<div>` card (kindred#2063-style gap: no keyboard listener at all). It is
// now a real <button> around the name, so mouse click and Tab+Enter both work.
describe('ParseAnalysisGroupedList', () => {
  it('selects a camper when the name is clicked', async () => {
    const onCamperSelect = vi.fn()
    const user = userEvent.setup()
    render(<ParseAnalysisGroupedList {...baseProps()} onCamperSelect={onCamperSelect} />)

    await user.click(screen.getByRole('button', { name: 'Emma Johnson' }))

    expect(onCamperSelect).toHaveBeenCalledWith(1001)
  })

  it('selects a camper via keyboard (Tab + Enter reaches the name button)', async () => {
    const onCamperSelect = vi.fn()
    const user = userEvent.setup()
    render(<ParseAnalysisGroupedList {...baseProps()} onCamperSelect={onCamperSelect} />)

    screen.getByRole('button', { name: 'Emma Johnson' }).focus()
    await user.keyboard('{Enter}')

    expect(onCamperSelect).toHaveBeenCalledWith(1001)
  })

  it('reparsing a camper does not also select it', async () => {
    const onCamperSelect = vi.fn()
    const onReparseCamper = vi.fn()
    const user = userEvent.setup()
    render(
      <ParseAnalysisGroupedList
        {...baseProps()}
        onCamperSelect={onCamperSelect}
        onReparseCamper={onReparseCamper}
      />
    )

    // Both campers lack debug results, so only the Reparse button shows for
    // either; the first one in list order belongs to Emma Johnson (1001).
    await user.click(screen.getAllByTitle('Reparse visible fields')[0]!)

    expect(onReparseCamper).toHaveBeenCalledWith(1001)
    expect(onCamperSelect).not.toHaveBeenCalled()
  })
})
