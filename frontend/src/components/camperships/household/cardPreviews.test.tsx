/** R2 (owner ruling 10-05): a resting card reads the preview its money editor would open on. */
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { gridRow, roundOut, ROW_OLIVIA } from '../requests/gridFixtures'
import { usePrefetchCardPreviews } from './cardPreviews'

const prefetch = vi.fn()
vi.mock('../../../hooks/camperships/useAidEditorPreview', () => ({
  usePrefetchAidPreview: (...args: unknown[]) => {
    prefetch(...args)
  },
}))

beforeEach(() => prefetch.mockReset())

// R2: a resting card reads the preview its money editor would open on, so the line is there at once.
describe('usePrefetchCardPreviews (R2)', () => {
  function Card({
    row,
    edits,
  }: {
    row: Parameters<typeof usePrefetchCardPreviews>[0]
    edits: Parameters<typeof usePrefetchCardPreviews>[1]
  }) {
    usePrefetchCardPreviews(row, edits)
    return null
  }
  const amounts = () => prefetch.mock.calls.map((call) => (call as unknown[]).slice(1))

  it("prefetches the appeal's ask, when the card offers the appeal", () => {
    render(<Card row={ROW_OLIVIA} edits={['appeal']} />)
    expect(prefetch).toHaveBeenCalledWith('reqolivia000003', 2, 1200)
    expect(amounts()).toContainEqual([3, null])
  })

  it('prefetches a Round 3 amount on its pending figure, else the decided one', () => {
    const pendingRow = gridRow({
      ...ROW_OLIVIA,
      rounds: [
        roundOut(1, 'posted'),
        roundOut(3, 'needs_offer', { ask: 900, decided: 300, pending_approval: 500 }),
      ],
    })
    render(<Card row={pendingRow} edits={['round3_ask', 'round3_amount']} />)
    expect(prefetch).toHaveBeenCalledWith('reqolivia000003', 3, 500)
    expect(amounts()).toContainEqual([2, null])
  })

  it('prefetches nothing for an edit the card does not offer, or one that opens empty', () => {
    const askedRow = gridRow({
      ...ROW_OLIVIA,
      rounds: [roundOut(1, 'posted'), roundOut(3, 'needs_offer', { ask: 900 })],
    })
    render(<Card row={askedRow} edits={['round3_ask', 'round3_amount']} />)
    expect(amounts()).toEqual([
      [2, null],
      [3, null],
    ])
  })
})
