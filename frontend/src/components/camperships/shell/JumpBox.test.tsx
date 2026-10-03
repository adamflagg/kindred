import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { acquireOverlayToken, releaseOverlayToken } from '../../ui/modalStack'
import { JumpBox } from './JumpBox'

const LOADED = {
  data: {
    year: 2027,
    households: [
      {
        household_cm_id: 1000001,
        family_name: 'Johnson',
        people: [{ person_cm_id: 1000002, name: 'Emma Johnson', role: 'camper' }],
      },
      {
        household_cm_id: 1000005,
        family_name: 'Chen',
        people: [{ person_cm_id: 1000006, name: 'Olivia Chen', role: 'camper' }],
      },
    ],
  },
  isPending: false,
  error: null,
}
let index: { data?: typeof LOADED.data; isPending: boolean; error: Error | null } = LOADED
vi.mock('../../../hooks/camperships/useAidJumpIndex', () => ({ useAidJumpIndex: () => index }))
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function renderBox(entry = '/aid/requests') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <JumpBox />
      <input aria-label="Another field" />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
}

const box = () => screen.getByRole('textbox', { name: 'Jump to a family' })

beforeEach(() => {
  index = LOADED
})

describe('JumpBox (§3.5; D13)', () => {
  // jsdom has no layout: this pins the classes. The real proof is the 1280px measurement.
  it('gives way on a crowded bar, but keeps room to read its placeholder', () => {
    renderBox()
    expect(box().parentElement).toHaveClass('shrink', 'min-w-40')
  })

  // Ruling 2026-10-01 (plan review): the four-states rule.
  it('says it is loading, and takes no search until the index is in', () => {
    index = { isPending: true, error: null }
    renderBox()
    expect(box()).toBeDisabled()
    expect(box()).toHaveAttribute('placeholder', 'Loading families…')
  })

  it('says when the index could not load', () => {
    index = { isPending: false, error: new Error('boom') }
    renderBox()
    expect(box()).toBeDisabled()
    expect(box()).toHaveAttribute('placeholder', 'Search unavailable')
  })

  it('keeps searching the loaded index when a later refetch fails', async () => {
    index = { data: LOADED.data, isPending: false, error: new Error('refetch failed') }
    renderBox()
    expect(box()).toBeEnabled()
    expect(box()).toHaveAttribute('placeholder', 'Family, camper or CM id')
    await userEvent.type(box(), 'chen')
    expect(screen.getByRole('button', { name: /Chen/ })).toBeInTheDocument()
  })

  it('leaves "/" alone while a modifier is held', async () => {
    renderBox()
    await userEvent.keyboard('{Control>}/{/Control}')
    expect(box()).not.toHaveFocus()
  })

  it('takes focus on "/" from the page', async () => {
    renderBox()
    await userEvent.keyboard('/')
    expect(box()).toHaveFocus()
    expect(box()).toHaveValue('')
  })

  it('leaves "/" alone on a held-down repeat, so it is never typed into the box', () => {
    renderBox()
    fireEvent.keyDown(document.body, { key: '/', repeat: true })
    expect(box()).not.toHaveFocus()
  })

  it('leaves "/" alone during an IME composition', () => {
    renderBox()
    fireEvent.keyDown(document.body, { key: '/', isComposing: true })
    expect(box()).not.toHaveFocus()
  })

  it('leaves "/" alone while a modal is open', () => {
    renderBox()
    const token = acquireOverlayToken()
    try {
      fireEvent.keyDown(document.body, { key: '/' })
      expect(box()).not.toHaveFocus()
    } finally {
      releaseOverlayToken(token)
    }
  })

  it('does not navigate on Enter while an IME is composing', () => {
    renderBox()
    fireEvent.change(box(), { target: { value: 'olivia' } })
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true })
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/requests')
  })

  it('opens a result only on the primary mouse button', () => {
    renderBox()
    fireEvent.change(box(), { target: { value: 'john' } })
    const row = screen.getByRole('button', { name: /Johnson/ })
    fireEvent.mouseDown(row, { button: 2 })
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/requests')
    fireEvent.mouseDown(row, { button: 0 })
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000001')
  })

  it('leaves "/" alone while you type in another field', async () => {
    renderBox()
    await userEvent.click(screen.getByRole('textbox', { name: 'Another field' }))
    await userEvent.keyboard('/')
    expect(box()).not.toHaveFocus()
  })

  it('opens the top match on Enter, carrying the season (D15)', async () => {
    renderBox()
    await userEvent.type(box(), 'olivia{Enter}')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000005?year=2027')
  })

  it('carries a past as-of to the household page (D15)', async () => {
    renderBox('/aid/requests?as_of=2026-08-01')
    await userEvent.type(box(), 'olivia{Enter}')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/households/1000005?year=2027&as_of=2026-08-01'
    )
  })

  it('moves through the matches with ↓ before Enter', async () => {
    renderBox()
    // "10000" prefixes both household ids (a tie, broken by family name: Chen, then Johnson).
    await userEvent.type(box(), '10000{ArrowDown}{Enter}')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000001')
  })

  it('keeps the highlight on a real match when a refetch shortens the list', async () => {
    const tree = () => (
      <MemoryRouter initialEntries={['/aid/requests']}>
        <JumpBox />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    )
    const { rerender } = render(tree())
    // "10000" matches both; ↓ highlights the second (Johnson).
    await userEvent.type(box(), '10000{ArrowDown}')
    // A refetch drops Johnson, so only Chen is left.
    index = { ...LOADED, data: { ...LOADED.data, households: LOADED.data.households.slice(1) } }
    rerender(tree())
    await userEvent.type(box(), '{Enter}')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000005')
  })

  it('opens a match on click', async () => {
    renderBox()
    await userEvent.type(box(), 'john')
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000001')
  })

  // Owner ruling 2026-10-03: a result leads with the matched person, the household is secondary.
  const rowText = (name: RegExp) => screen.getByRole('button', { name }).textContent
  const leadSpan = (name: RegExp) => screen.getByRole('button', { name }).querySelector('span')

  it('leads a person-name match with the person, then role and household', async () => {
    renderBox()
    await userEvent.type(box(), 'emma')
    expect(rowText(/Emma/)).toBe('Emma Johnson · camper · Johnson household')
    expect(leadSpan(/Emma/)).toHaveTextContent(/^Emma Johnson$/)
    expect(leadSpan(/Emma/)).toHaveClass('font-medium')
  })

  it('leads a family-name match with the household', async () => {
    renderBox()
    await userEvent.type(box(), 'chen')
    expect(rowText(/Chen/)).toBe('Chen family')
    expect(leadSpan(/Chen/)).toHaveClass('font-medium')
  })

  it('leads a person-id match with the person and keeps the id visible', async () => {
    renderBox()
    await userEvent.type(box(), '1000006')
    expect(rowText(/Olivia/)).toBe('Olivia Chen · camper · person 1000006 · Chen household')
    expect(leadSpan(/Olivia/)).toHaveTextContent(/^Olivia Chen$/)
  })

  it('leads a household-id match with the household and its id', async () => {
    renderBox()
    await userEvent.type(box(), '1000005')
    expect(rowText(/Chen/)).toBe('Chen household 1000005')
    expect(leadSpan(/Chen/)).toHaveTextContent(/^Chen$/)
  })

  it('clears and lets go on Esc', async () => {
    renderBox()
    await userEvent.type(box(), 'john{Escape}')
    expect(box()).toHaveValue('')
    expect(box()).not.toHaveFocus()
  })
})
