import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AidView } from '../kit/asOf'
import { GRID_ROWS } from '../requests/gridFixtures'
import { QueueWalkStrip } from './QueueWalkStrip'
import { useQueueWalk } from './useQueueWalk'

let rows: typeof GRID_ROWS
const prefetched: Array<number | null> = []
vi.mock('../../../hooks/camperships/useAidGrid', () => ({
  useAidGrid: () => ({ data: { year: 2027, rules_version: 1, rows } }),
}))
vi.mock('../../../hooks/camperships/useAidHouseholdPage', () => ({
  usePrefetchHousehold: (id: number | null) => {
    prefetched.push(id)
  },
}))

const VIEW: AidView = { year: 2027, asOf: { kind: 'live' } }

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function Page({ beforeLeave }: { beforeLeave?: ((go: () => void) => void) | undefined }) {
  // The id follows the route, as the household page's does.
  const { householdCmId } = useParams()
  const id = Number(householdCmId)
  const navigate = useNavigate()
  const walk = useQueueWalk(id, VIEW, beforeLeave)
  return (
    <>
      <button type="button" onClick={() => void navigate('/aid/households/9999999?from=all')}>
        jump to a family outside the view
      </button>
      {walk && <QueueWalkStrip walk={walk} beforeLeave={beforeLeave} />}
      <Where />
    </>
  )
}

function tree(path: string, beforeLeave?: (go: () => void) => void) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/aid/households/:householdCmId" element={<Page beforeLeave={beforeLeave} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
}

const without = (id: number) => GRID_ROWS.filter((row) => row.household_cm_id !== id)

beforeEach(() => {
  rows = GRID_ROWS
  prefetched.length = 0
})

describe('the walk after the family leaves the view (PR 7 I2)', () => {
  it('keeps both remembered neighbours, and ] steps to the remembered next', async () => {
    const { rerender } = render(tree('/aid/households/1000005?from=all'))
    expect(screen.getByText(/3 of 4 families/)).toBeInTheDocument()
    rows = without(1000005)
    rerender(tree('/aid/households/1000005?from=all'))
    expect(screen.getByText('not in All now')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /‹ The Garcia Family/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /The Sam Family.* ›/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← Back to All' })).toBeInTheDocument()
    expect(prefetched.at(-1)).toBe(1000007)
    await userEvent.keyboard(']')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/households/1000007?from=all&year=2027'
    )
  })

  it('offers only the previous when the family was last', () => {
    const { rerender } = render(tree('/aid/households/1000007?from=all'))
    rows = without(1000007)
    rerender(tree('/aid/households/1000007?from=all'))
    expect(screen.getByText('not in All now')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /‹ The Chen Family/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /›$/ })).toBeNull()
  })

  it('a fresh arrival on a family not in the view has no neighbours', () => {
    rows = without(1000005)
    render(tree('/aid/households/1000005?from=all'))
    expect(screen.getByText('not in All now')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /‹|›$/ })).toBeNull()
  })
})

describe('the remembered neighbours (PR 8 review m4-m6)', () => {
  it('follows the neighbours by household when another family leaves too', () => {
    const { rerender } = render(tree('/aid/households/1000005?from=all'))
    expect(screen.getByText(/3 of 4 families/)).toBeInTheDocument()
    rows = GRID_ROWS.filter(
      (row) => row.household_cm_id !== 1000005 && row.household_cm_id !== 1000001
    )
    rerender(tree('/aid/households/1000005?from=all'))
    expect(screen.getByRole('link', { name: /‹ The Garcia Family/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /The Sam Family.* ›/ })).toBeInTheDocument()
  })

  it('prints no edge words beside "not in X now" once the view is empty', () => {
    rows = GRID_ROWS.filter((row) => row.household_cm_id === 1000005)
    const { rerender } = render(tree('/aid/households/1000005?from=all'))
    expect(screen.getByText(/1 of 1 families/)).toBeInTheDocument()
    rows = []
    rerender(tree('/aid/households/1000005?from=all'))
    expect(screen.getByText('not in All now')).toBeInTheDocument()
    expect(screen.queryByText('start of the list')).toBeNull()
    expect(screen.queryByText('end of the list')).toBeNull()
  })

  it('returns to its place in the list when the family re-enters the view', () => {
    const { rerender } = render(tree('/aid/households/1000005?from=all'))
    rows = without(1000005)
    rerender(tree('/aid/households/1000005?from=all'))
    expect(screen.getByText('not in All now')).toBeInTheDocument()
    rows = GRID_ROWS
    rerender(tree('/aid/households/1000005?from=all'))
    expect(screen.getByText(/3 of 4 families/)).toBeInTheDocument()
    expect(screen.queryByText('not in All now')).toBeNull()
    expect(screen.getByRole('link', { name: /‹ The Garcia Family/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /The Sam Family.* ›/ })).toBeInTheDocument()
  })

  it('forgets the memory when the route moves to another family', async () => {
    render(tree('/aid/households/1000005?from=all'))
    await userEvent.click(screen.getByRole('button', { name: /jump to a family outside/ }))
    expect(screen.getByText('not in All now')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /‹|›$/ })).toBeNull()
  })

  it('has no previous link when the first family leaves, and the next is the old second', () => {
    const { rerender } = render(tree('/aid/households/1000001?from=all'))
    expect(screen.getByText(/1 of 4 families/)).toBeInTheDocument()
    rows = without(1000001)
    rerender(tree('/aid/households/1000001?from=all'))
    expect(screen.getByText('not in All now')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^‹/ })).toBeNull()
    expect(screen.getByRole('link', { name: /The Garcia Family.* ›/ })).toBeInTheDocument()
  })
})

describe('beforeLeave (owner F2 4)', () => {
  it('defers the ] key until go() runs', async () => {
    let go: (() => void) | null = null
    render(
      tree('/aid/households/1000005?from=all', (next) => {
        go = next
      })
    )
    await userEvent.keyboard(']')
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000005?from=all')
    expect(go).not.toBeNull()
    act(() => go!())
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000007')
  })

  it('does not navigate when beforeLeave never calls go, from a click either', async () => {
    const before = vi.fn()
    render(tree('/aid/households/1000005?from=all', before))
    await userEvent.click(screen.getByRole('link', { name: /The Sam Family.* ›/ }))
    await userEvent.click(screen.getByRole('link', { name: '← Back to All' }))
    expect(before).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000005?from=all')
  })

  it('a click goes once go() runs, to the link href', async () => {
    render(tree('/aid/households/1000005?from=all', (go) => go()))
    await userEvent.click(screen.getByRole('link', { name: '← Back to All' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/requests?view=all')
  })

  it('leaves a modified click to the browser', () => {
    const before = vi.fn()
    render(tree('/aid/households/1000005?from=all', before))
    const back = screen.getByRole('link', { name: '← Back to All' })
    // fireEvent returns false when the default was prevented: true means the browser still gets it.
    expect(fireEvent.click(back, { ctrlKey: true })).toBe(true)
    expect(fireEvent.click(back, { metaKey: true })).toBe(true)
    expect(before).not.toHaveBeenCalled()
  })

  it('without beforeLeave, ] and clicks navigate as before', async () => {
    render(tree('/aid/households/1000005?from=all'))
    await userEvent.click(screen.getByRole('link', { name: /The Sam Family.* ›/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000007')
  })
})
