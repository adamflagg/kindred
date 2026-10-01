import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('opens a match on click', async () => {
    renderBox()
    await userEvent.type(box(), 'john')
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000001')
  })

  it('clears and lets go on Esc', async () => {
    renderBox()
    await userEvent.type(box(), 'john{Escape}')
    expect(box()).toHaveValue('')
    expect(box()).not.toHaveFocus()
  })
})
