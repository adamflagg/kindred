/**
 * A checkbox in an editor (design-language rule 14, amended): Add a Request…'s "Record CampMinder's $2,258 as Round
 * 1, posted", checked by default. It keeps the editor field grammar: a caption in the label column, then a 30px row
 * holding the box and its sentence at 13.5px. The sentence is a real label, so a click on it checks the box. Switched
 * off, it stays on screen, dimmed (rule 14: shown off, never hidden).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { EditorCheck, EditorGrid } from './EditorLayout'

function Harness({ off = false, onChange }: { off?: boolean; onChange?: (v: boolean) => void }) {
  const [checked, setChecked] = useState(true)
  return (
    <EditorGrid columns={2}>
      <EditorCheck
        id="r1"
        label="Round 1"
        checked={checked}
        off={off}
        onChange={(v) => {
          setChecked(v)
          onChange?.(v)
        }}
      >
        Record CampMinder's $2,258 as Round 1, posted (Mar 9)
      </EditorCheck>
    </EditorGrid>
  )
}

describe('EditorCheck', () => {
  it('sits in the grid as caption · field, the box and its sentence on one 30px row at 13.5px', () => {
    render(<Harness />)
    const grid = screen.getByTestId('aid-editor-grid')
    expect(grid.children).toHaveLength(2)
    expect(grid.children[0]).toHaveTextContent('Round 1')
    const box = screen.getByRole('checkbox', { name: /Record CampMinder's \$2,258/ })
    const row = box.closest('label') as HTMLElement
    expect(row).toHaveClass('h-[30px]', 'text-[13.5px]', 'items-center', 'cursor-pointer')
    expect(box).toHaveClass('accent-primary')
  })

  it('shows the state it is given (checked by default here), and a click on its sentence unchecks it', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const box = screen.getByRole('checkbox')
    expect(box).toBeChecked()
    await userEvent.click(screen.getByText(/as Round 1, posted/))
    expect(onChange).toHaveBeenCalledWith(false)
    expect(box).not.toBeChecked()
  })

  it('the caption is a real label for the box too (a click on "Round 1" toggles it)', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByText('Round 1'))
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('switched off it stays on screen, disabled and dimmed, caption and sentence both', () => {
    render(<Harness off />)
    const box = screen.getByRole('checkbox')
    expect(box).toBeDisabled()
    expect(screen.getByText('Round 1')).toHaveClass('opacity-50')
    expect(box.closest('label')).toHaveClass('opacity-50', 'cursor-not-allowed')
  })

  it('takes the rest of its row in a four-column grid (a sentence, like a typed reason)', () => {
    render(
      <EditorGrid>
        <EditorCheck id="x" label="Round 1" checked onChange={() => {}}>
          Record it
        </EditorCheck>
      </EditorGrid>
    )
    const field = screen.getByRole('checkbox').closest('label')?.parentElement as HTMLElement
    expect(field).toHaveClass('col-[2/-1]')
  })
})
