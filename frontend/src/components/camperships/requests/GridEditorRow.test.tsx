import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { WalkEditorProps } from '../kit/useEditorWalk'
import { GridEditorRow } from './GridEditorRow'
import { ROW_OLIVIA, ROW_SAMUEL } from './gridFixtures'

// Each mount of the preview hook gets its own number, so a test can see a fresh one.
let mounts = 0
const seen: number[] = []
vi.mock('../../../hooks/camperships/useAidEditorPreview', () => ({
  useAidEditorPreview: () => {
    const [id] = useState(() => ++mounts)
    seen.push(id)
    return { preview: { status: 'idle' }, onAmountChange: () => undefined }
  },
}))

const WALK: WalkEditorProps = {
  draft: undefined,
  saving: false,
  saveError: null,
  showProblem: false,
  onDraftChange: () => undefined,
  onSave: () => undefined,
  onMove: () => undefined,
  onCancel: () => undefined,
  onGone: () => undefined,
}

const REFUSAL = 'Round 1 is not posted yet.'
const REFUSING = { ...ROW_OLIVIA, appeal_refusal: REFUSAL }

describe('GridEditorRow', () => {
  it("starts the preview afresh when the row changes under it (Task 12's carried note)", () => {
    const row = (r: typeof ROW_OLIVIA) => (
      <MemoryRouter>
        <GridEditorRow row={r} walk={WALK} />
      </MemoryRouter>
    )
    const { rerender } = render(row(ROW_OLIVIA))
    const first = seen[seen.length - 1]
    rerender(row(ROW_SAMUEL))
    expect(seen[seen.length - 1]).not.toBe(first)
  })

  // Owner fast-follow (10-03): the household is named once, by the detail line's "Household …›", so
  // the refusal's own "Open the Household ›" link is gone. Was: "words its action links in title
  // case (owner rule)", asserting that link.
  it('draws no household link of its own on a row that refuses an ask', () => {
    render(
      <MemoryRouter>
        <GridEditorRow row={REFUSING} walk={WALK} />
      </MemoryRouter>
    )
    expect(screen.queryByRole('link')).toBeNull()
  })

  // Owner fast-follow (a): the refusal shows only when someone tries to type on the row (a
  // printable key the page owns: kit/keyboard.ts isTypingAttempt). The row has no ask field to
  // focus, so a key is the only way to try.
  describe("the can't-take-an-ask sentence", () => {
    const renderRefusing = () =>
      render(
        <MemoryRouter>
          <input aria-label="Search" />
          <GridEditorRow row={REFUSING} walk={WALK} />
        </MemoryRouter>
      )

    it('is not shown when the row opens', () => {
      renderRefusing()
      expect(screen.queryByText(REFUSAL)).toBeNull()
    })

    it('shows once a printable key is pressed on the row, and stays', async () => {
      renderRefusing()
      await userEvent.keyboard('5')
      expect(screen.getByText(REFUSAL)).toBeInTheDocument()
      await userEvent.keyboard('{ArrowDown}')
      expect(screen.getByText(REFUSAL)).toBeInTheDocument()
    })

    // Scan K2 (#3000): the sentence grows the opened row after the table scrolled it into view, so
    // on a row walked to with ↓ (flush with the box's bottom) it would land out of sight.
    it('brings the sentence into view when it appears', async () => {
      renderRefusing()
      const scroll = vi.mocked(Element.prototype.scrollIntoView)
      scroll.mockClear()
      await userEvent.keyboard('5')
      const sentence = screen.getByText(REFUSAL)
      const scrolled: unknown[] = scroll.mock.contexts
      expect(scrolled.some((el) => el instanceof Element && el.contains(sentence))).toBe(true)
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    })

    it('ignores the arrows, Esc, the page keys / [ ], a modified key, and typing in a field', async () => {
      renderRefusing()
      await userEvent.keyboard('{ArrowDown}{ArrowUp}{Escape}/[[]] ')
      fireEvent.keyDown(window, { key: '5', ctrlKey: true })
      await userEvent.type(screen.getByLabelText('Search'), '123')
      expect(screen.queryByText(REFUSAL)).toBeNull()
    })
  })

  it('opens the ask editor as the panel on a row that takes one', () => {
    render(
      <MemoryRouter>
        <GridEditorRow row={ROW_OLIVIA} walk={WALK} />
      </MemoryRouter>
    )
    expect(screen.getByLabelText('Round 2 ask')).toBeInTheDocument()
    expect(screen.queryByText(/· household /)).toBeNull()
  })
})
