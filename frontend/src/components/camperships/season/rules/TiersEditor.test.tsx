/** The tiers editor (spec §6.2 E.2; Review Focus 2): start, band width, count and ceiling, by hand and back. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { bandsOf } from './tierGrid'
import { TiersEditor } from './TiersEditor'

const OPENED = { bands: bandsOf(0, 35000, 11), income_ceiling: null, floor_tier: 1 }

function Harness() {
  const [content, setContent] = useState<Record<string, unknown> | null>(null)
  return (
    <>
      <TiersEditor tiers={OPENED} onContent={setContent} problem={null} />
      <pre data-testid="content">{JSON.stringify(content)}</pre>
    </>
  )
}

const reported = () => JSON.parse(screen.getByTestId('content').textContent)

describe('the tiers editor (spec §6.2 E.2; Review Focus 2)', () => {
  it('opens on the even bands: Start $0, Band width $35,000, Tiers 11, no ceiling, no floor box', () => {
    render(<Harness />)
    expect(screen.getByLabelText('Start')).toHaveValue('0')
    expect(screen.getByLabelText('Band width')).toHaveValue('35000')
    expect(screen.getByLabelText('Tiers')).toHaveValue('11')
    expect(screen.getByLabelText('Income ceiling')).toHaveValue('')
    expect(screen.queryByLabelText(/Lowest final tier/)).toBeNull()
  })

  it('rebuilds the bands with the +$1 edge, says "was 11", and notes what saving adds', async () => {
    render(<Harness />)
    await userEvent.clear(screen.getByLabelText('Tiers'))
    await userEvent.type(screen.getByLabelText('Tiers'), '12')
    expect(screen.getByText('was 11')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Saving adds tier 12 to the Round 1 and appeal tables, empty: fill it in before approving.'
      )
    ).toBeInTheDocument()
    const content = reported()
    expect(content.bands).toHaveLength(12)
    expect(content.bands[11]).toEqual({ lower: '385001', upper: null })
  })

  it('notes what saving drops on fewer tiers', async () => {
    render(<Harness />)
    await userEvent.clear(screen.getByLabelText('Tiers'))
    await userEvent.type(screen.getByLabelText('Tiers'), '9')
    expect(
      screen.getByText('Saving drops tiers 10–11 from the Round 1 and appeal tables.')
    ).toBeInTheDocument()
  })

  it('edits bands by hand and goes back to even bands', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit bands by hand ›' }))
    expect(screen.getByLabelText('Band width')).toBeDisabled()
    const top1 = screen.getByLabelText('Tier 1 top')
    await userEvent.clear(top1)
    await userEvent.type(top1, '30000')
    const content = reported()
    expect(content.bands[0]).toEqual({ lower: '0', upper: '30000' })
    expect(content.bands[1].lower).toBe('30001')
    await userEvent.click(screen.getByRole('button', { name: 'Back to even bands' }))
    expect(screen.getByLabelText('Band width')).not.toBeDisabled()
  })

  it('reports nothing to save while a box is not a figure', async () => {
    render(<Harness />)
    await userEvent.clear(screen.getByLabelText('Band width'))
    await userEvent.type(screen.getByLabelText('Band width'), 'abc')
    expect(screen.getByTestId('content')).toHaveTextContent('null')
  })

  it('saves the income ceiling as typed, and none as null (Income ceiling empty = none)', async () => {
    // Added beyond the plan's five: the ceiling is half of what the section writes.
    render(<Harness />)
    expect(reported().income_ceiling).toBeNull()
    await userEvent.type(screen.getByLabelText('Income ceiling'), '400000')
    expect(reported().income_ceiling).toBe('400000')
    await userEvent.clear(screen.getByLabelText('Income ceiling'))
    expect(reported().income_ceiling).toBeNull()
  })
})
