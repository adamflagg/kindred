import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { GridFiltersBar } from './GridFiltersBar'
import type { ProgramGroup } from './programLabel'

const GROUPS: readonly ProgramGroup[] = [
  {
    pool: { value: 'pool_a', label: 'Pool A' },
    programs: [
      { value: 'quest', label: 'Quest' },
      { value: 'summer', label: 'Summer' },
    ],
  },
  {
    pool: { value: 'pool_b', label: 'Pool B' },
    programs: [{ value: 'family_camp', label: 'Family Camp' }],
  },
  { pool: null, programs: [{ value: 'not_aided', label: 'Not aided' }] },
]

function bar(props: {
  program?: string | null
  pool?: string | null
  round?: 1 | 2 | 3 | null
  counted?: boolean
}) {
  const onChange = vi.fn()
  const onProgramPool = vi.fn()
  render(
    <GridFiltersBar
      groups={GROUPS}
      program={props.program ?? null}
      pool={props.pool ?? null}
      round={props.round ?? null}
      counted={props.counted ?? false}
      onChange={onChange}
      onProgramPool={onProgramPool}
    />
  )
  return { onChange, onProgramPool }
}

const openProgram = async () => {
  await userEvent.click(screen.getByLabelText('Program'))
  return screen.findAllByRole('option')
}

describe('GridFiltersBar: one grouped Program dropdown (T6)', () => {
  it('is one control labelled Program; the separate Pool filter is gone', () => {
    bar({})
    expect(screen.getByLabelText('Program')).toHaveTextContent('All programs')
    expect(screen.queryByLabelText('Pool')).toBeNull()
  })

  it('lists each pool heading with its programs under it, a program in no pool last', async () => {
    bar({})
    expect((await openProgram()).map((o) => o.textContent)).toEqual([
      'All programs',
      'Pool A',
      'Quest',
      'Summer',
      'Pool B',
      'Family Camp',
      'Not aided',
    ])
  })

  it('picks a pool by its heading (the program cleared), and a program (the pool cleared)', async () => {
    const { onProgramPool } = bar({ program: 'summer' })
    await openProgram()
    await userEvent.click(screen.getByRole('option', { name: 'Pool B' }))
    expect(onProgramPool).toHaveBeenLastCalledWith('pool_b', null)
    await openProgram()
    await userEvent.click(screen.getByRole('option', { name: 'Quest' }))
    expect(onProgramPool).toHaveBeenLastCalledWith(null, 'quest')
    await openProgram()
    await userEvent.click(screen.getByRole('option', { name: 'All programs' }))
    expect(onProgramPool).toHaveBeenLastCalledWith(null, null)
  })

  it('shows what the URL picked: a pool by its heading, a program by its name', () => {
    bar({ pool: 'pool_b' })
    expect(screen.getByLabelText('Program')).toHaveTextContent('Pool B')
  })

  it('shows a picked program by its name', () => {
    bar({ program: 'family_camp' })
    expect(screen.getByLabelText('Program')).toHaveTextContent('Family Camp')
  })

  it('marks the picked option', async () => {
    bar({ pool: 'pool_a' })
    await openProgram()
    expect(screen.getByRole('option', { name: 'Pool A' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'Quest' })).toHaveAttribute('aria-selected', 'false')
  })
})

describe('GridFiltersBar out-of-list values (A5)', () => {
  it('shows a program the options do not hold, and choosing All clears it', async () => {
    const { onProgramPool } = bar({ program: 'nosuch' })
    expect(screen.getByLabelText('Program')).toHaveTextContent('nosuch')
    await openProgram()
    expect(screen.getByRole('option', { name: 'nosuch' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('option', { name: 'All programs' }))
    expect(onProgramPool).toHaveBeenCalledWith(null, null)
  })

  it('shows a pool the options do not hold', async () => {
    bar({ pool: 'gone' })
    expect(screen.getByLabelText('Program')).toHaveTextContent('gone')
    await openProgram()
    expect(screen.getByRole('option', { name: 'gone' })).toHaveAttribute('aria-selected', 'true')
  })

  it('adds no extra option for an in-list value', async () => {
    bar({ program: 'summer' })
    await openProgram()
    expect(screen.getAllByRole('option', { name: 'Summer' })).toHaveLength(1)
  })
})

// Spec change (owner, 2026-10-02): Round and Checklist are toggle chips, not <select>s. A URL value
// outside the list parses to null before it reaches the bar, so the old "shows a checklist value the
// options do not hold" select test has no chip equivalent and is gone.
// Owner ruling (fast-follow, 10-03): under D162 there are no Posted ticks, so the Checklist chips
// (Posted, Accepted) are gone. Was: "Round and Checklist chips", with a checklist chip test and
// Posted/Accepted in the lit checks.
describe('GridFiltersBar: Round chips', () => {
  const lit = (name: string) =>
    screen.getByRole('button', { name }).className.includes('bg-primary ')

  it('lights none when no round is picked', () => {
    bar({})
    for (const name of ['R1', 'R2', 'R3']) expect(lit(name)).toBe(false)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('draws no Checklist chips: Posted and Accepted are gone (D162)', () => {
    bar({})
    expect(screen.queryByText('Checklist')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Posted' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accepted' })).toBeNull()
  })

  it('sets the round param from a chip, with the same value the select used', async () => {
    const { onChange } = bar({})
    await userEvent.click(screen.getByRole('button', { name: 'R2' }))
    expect(onChange).toHaveBeenCalledWith('round', '2')
  })

  it('lights only the picked chip, and clicking it clears the param', async () => {
    const { onChange } = bar({ round: 3 })
    expect(lit('R3')).toBe(true)
    expect(lit('R1')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'R3' }))
    expect(onChange).toHaveBeenLastCalledWith('round', null)
  })

  it('moves to another round in one click, one at a time', async () => {
    const { onChange } = bar({ round: 1 })
    await userEvent.click(screen.getByRole('button', { name: 'R2' }))
    expect(onChange).toHaveBeenLastCalledWith('round', '2')
  })
})

describe('GridFiltersBar counted filter', () => {
  it('toggles Counting toward the budget through onChange', async () => {
    const { onChange } = bar({})
    await userEvent.click(screen.getByRole('checkbox', { name: 'Counting toward the budget' }))
    expect(onChange).toHaveBeenCalledWith('counted', '1')
  })

  it('clears it when unchecked', async () => {
    const { onChange } = bar({ counted: true })
    const box = screen.getByRole('checkbox', { name: 'Counting toward the budget' })
    expect(box).toBeChecked()
    await userEvent.click(box)
    expect(onChange).toHaveBeenCalledWith('counted', null)
  })
})
