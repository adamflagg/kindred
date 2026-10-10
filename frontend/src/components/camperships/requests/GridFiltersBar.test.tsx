/**
 * Requests' toolbar filters in the final language (design-language §3, §5, §18; the approved mock):
 * Program is the white AidPicker with each pool a pickable bold heading and its programs indented;
 * Round is the grey segmented well, and clicking the lit round clears it.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { GridFiltersBar, ShowIdsToggle } from './GridFiltersBar'
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

function bar(props: { program?: string | null; pool?: string | null; round?: 1 | 2 | 3 | null }) {
  const onChange = vi.fn()
  const onProgramPool = vi.fn()
  render(
    <GridFiltersBar
      groups={GROUPS}
      program={props.program ?? null}
      pool={props.pool ?? null}
      round={props.round ?? null}
      onChange={onChange}
      onProgramPool={onProgramPool}
    />
  )
  return { onChange, onProgramPool }
}

// Owner ruling (final audit): Requests' Program is the program the rules price under.
it('labels the Program filter "as priced"', () => {
  bar({})
  expect(screen.getByText('Program (as priced)')).toBeInTheDocument()
})

const programButton = () => screen.getByRole('button', { name: /^Program \(as priced\):/ })
const openProgram = async () => {
  await userEvent.click(programButton())
  return screen.findAllByRole('option')
}

describe('GridFiltersBar: the Program picker (T6, §3)', () => {
  it('is the white 26px picker labelled Program; the separate Pool filter is gone', () => {
    bar({})
    expect(programButton()).toHaveTextContent('All programs')
    expect(programButton()).toHaveClass('bg-card', 'h-[26px]')
    expect(screen.queryByRole('button', { name: /^Pool/ })).toBeNull()
    expect(document.querySelector('select')).toBeNull()
  })

  it('lists each pool heading (bold) with its programs indented under it, a program in no pool last', async () => {
    bar({})
    const options = await openProgram()
    expect(options.map((o) => o.textContent.replace('✓', ''))).toEqual([
      'All programs',
      'Pool A',
      'Quest',
      'Summer',
      'Pool B',
      'Family Camp',
      'Not aided',
    ])
    expect(options[1]).toHaveClass('font-bold')
    expect(options[2]?.style.paddingLeft).toBe('34px')
    expect(options[6]?.style.paddingLeft).toBe('')
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
    expect(programButton()).toHaveTextContent('Pool B')
  })

  it('shows a picked program by its name', () => {
    bar({ program: 'family_camp' })
    expect(programButton()).toHaveTextContent('Family Camp')
  })

  it('marks the picked option', async () => {
    bar({ pool: 'pool_a' })
    await openProgram()
    expect(screen.getByRole('option', { name: /Pool A/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'Quest' })).toHaveAttribute('aria-selected', 'false')
  })
})

describe('GridFiltersBar out-of-list values (A5)', () => {
  it('shows a program the options do not hold, and choosing All clears it', async () => {
    const { onProgramPool } = bar({ program: 'nosuch' })
    expect(programButton()).toHaveTextContent('nosuch')
    await openProgram()
    expect(screen.getByRole('option', { name: /nosuch/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('option', { name: 'All programs' }))
    expect(onProgramPool).toHaveBeenCalledWith(null, null)
  })

  it('shows a pool the options do not hold', async () => {
    bar({ pool: 'gone' })
    expect(programButton()).toHaveTextContent('gone')
    await openProgram()
    expect(screen.getByRole('option', { name: /gone/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('adds no extra option for an in-list value', async () => {
    bar({ program: 'summer' })
    await openProgram()
    expect(screen.getAllByRole('option', { name: /Summer/ })).toHaveLength(1)
  })
})

// Owner (fast-follow, 10-03): no Checklist chips under D162. Final language §18: Round is the segmented
// well (R1 R2 R3), a click on the lit one clears it (as the chips did).
describe('GridFiltersBar: the Round switcher', () => {
  const lit = (name: string) =>
    screen.getByRole('button', { name }).className.includes('bg-primary ')

  it('is a grey segmented group, lighting none when no round is picked', () => {
    bar({})
    expect(screen.getByRole('group', { name: 'Round' })).toBeInTheDocument()
    for (const name of ['R1', 'R2', 'R3']) expect(lit(name)).toBe(false)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('draws no Checklist chips: Posted and Accepted are gone (D162)', () => {
    bar({})
    expect(screen.queryByText('Checklist')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Posted' })).toBeNull()
  })

  it('sets the round param from a segment', async () => {
    const { onChange } = bar({})
    await userEvent.click(screen.getByRole('button', { name: 'R2' }))
    expect(onChange).toHaveBeenCalledWith('round', '2')
  })

  it('lights only the picked segment, and clicking it clears the param', async () => {
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

  it('does not forward a click on the word Round to a segment', async () => {
    const { onChange } = bar({})
    await userEvent.click(screen.getByText('Round'))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('ShowIdsToggle', () => {
  it('holds Show IDs in the URL through onChange, at the toolbar’s 12.5px', async () => {
    const onChange = vi.fn()
    render(<ShowIdsToggle showIds={false} onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show IDs' }))
    expect(onChange).toHaveBeenCalledWith('ids', '1')
    expect(screen.getByText('Show IDs').closest('label')).toHaveClass('text-[12.5px]')
  })
})
