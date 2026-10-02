import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { GridFiltersBar } from './GridFiltersBar'
import type { ProgramGroup } from './programLabel'

const GROUPS: readonly ProgramGroup[] = [
  {
    pool: { value: 'pool_a', label: 'Camp & Quest' },
    programs: [
      { value: 'quest', label: 'Quest' },
      { value: 'summer', label: 'Summer' },
    ],
  },
  {
    pool: { value: 'pool_b', label: 'Weekend Programs' },
    programs: [{ value: 'family_camp', label: 'Family Camp' }],
  },
  { pool: null, programs: [{ value: 'not_aided', label: 'Not aided' }] },
]

function bar(props: {
  program?: string | null
  pool?: string | null
  round?: 1 | 2 | 3 | null
  tick?: 'posted' | 'accepted' | null
}) {
  const onChange = vi.fn()
  const onProgramPool = vi.fn()
  render(
    <GridFiltersBar
      groups={GROUPS}
      program={props.program ?? null}
      pool={props.pool ?? null}
      round={props.round ?? null}
      tick={props.tick ?? null}
      showIds={false}
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
      'Camp & Quest',
      'Quest',
      'Summer',
      'Weekend Programs',
      'Family Camp',
      'Not aided',
    ])
  })

  it('picks a pool by its heading (the program cleared), and a program (the pool cleared)', async () => {
    const { onProgramPool } = bar({ program: 'summer' })
    await openProgram()
    await userEvent.click(screen.getByRole('option', { name: 'Weekend Programs' }))
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
    expect(screen.getByLabelText('Program')).toHaveTextContent('Weekend Programs')
  })

  it('shows a picked program by its name', () => {
    bar({ program: 'family_camp' })
    expect(screen.getByLabelText('Program')).toHaveTextContent('Family Camp')
  })

  it('marks the picked option', async () => {
    bar({ pool: 'pool_a' })
    await openProgram()
    expect(screen.getByRole('option', { name: 'Camp & Quest' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
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

  it('shows a checklist value the options do not hold', () => {
    bar({ tick: 'bogus' as 'posted' })
    expect(screen.getByLabelText('Checklist')).toHaveValue('bogus')
  })

  it('adds no extra option for an in-list value', async () => {
    bar({ program: 'summer' })
    await openProgram()
    expect(screen.getAllByRole('option', { name: 'Summer' })).toHaveLength(1)
  })
})
