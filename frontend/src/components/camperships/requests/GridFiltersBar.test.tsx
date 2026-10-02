import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { GridFiltersBar } from './GridFiltersBar'

function bar(props: {
  program?: string | null
  pool?: string | null
  round?: 1 | 2 | 3 | null
  tick?: 'posted' | 'accepted' | null
  counted?: boolean
}) {
  const onChange = vi.fn()
  render(
    <GridFiltersBar
      programs={[{ value: 'summer', label: 'Summer' }]}
      pools={[{ value: 'general', label: 'General' }]}
      program={props.program ?? null}
      pool={props.pool ?? null}
      round={props.round ?? null}
      tick={props.tick ?? null}
      counted={props.counted ?? false}
      showIds={false}
      onChange={onChange}
    />
  )
  return onChange
}

describe('GridFiltersBar out-of-list values', () => {
  it('shows a program the options do not hold, and choosing All clears it', async () => {
    const onChange = bar({ program: 'nosuch' })
    const select = screen.getByLabelText('Program')
    expect(select).toHaveValue('nosuch')
    expect(screen.getByRole('option', { name: 'nosuch' })).toBeTruthy()
    await userEvent.selectOptions(select, '')
    expect(onChange).toHaveBeenCalledWith('program', null)
  })

  it('shows a pool the options do not hold', () => {
    bar({ pool: 'gone' })
    expect(screen.getByLabelText('Pool')).toHaveValue('gone')
  })

  it('shows a checklist value the options do not hold', () => {
    bar({ tick: 'bogus' as 'posted' })
    expect(screen.getByLabelText('Checklist')).toHaveValue('bogus')
  })

  it('adds no extra option for an in-list value', () => {
    bar({ program: 'summer' })
    expect(screen.getAllByRole('option', { name: 'Summer' })).toHaveLength(1)
  })
})

describe('GridFiltersBar counted filter', () => {
  it('toggles Counting toward the budget through onChange', async () => {
    const onChange = bar({})
    await userEvent.click(screen.getByRole('checkbox', { name: 'Counting toward the budget' }))
    expect(onChange).toHaveBeenCalledWith('counted', '1')
  })

  it('clears it when unticked', async () => {
    const onChange = bar({ counted: true })
    const box = screen.getByRole('checkbox', { name: 'Counting toward the budget' })
    expect(box).toBeChecked()
    await userEvent.click(box)
    expect(onChange).toHaveBeenCalledWith('counted', null)
  })
})
