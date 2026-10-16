/**
 * Campers by age on Registration › Overview (epic #3207, owner ruling D-UNCOVERED).
 * Written before the component (TDD).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { AgeChart } from './AgeChart'
import { AGE_NOTE, AGE_NOTES } from './ageNotes'
import { transformAgeData } from '../../utils/metricsTransforms'
import type { AgeBandBreakdown } from '../../types/metrics'

const BY_AGE: AgeBandBreakdown[] = [
  { band: '5-7', count: 22, percentage: 1.7 },
  { band: '8-10', count: 401, percentage: 31.1 },
  { band: '11-13', count: 545, percentage: 42.2 },
  { band: '14-16', count: 259, percentage: 20.1 },
  { band: '17+', count: 64, percentage: 5.0 },
  { band: 'none', count: 0, percentage: 0 },
]

describe('transformAgeData', () => {
  it('labels the six bands in order with en dashes, None last, and keeps the band key as the id', () => {
    expect(transformAgeData(BY_AGE)).toEqual([
      { name: '5–7', value: 22, percentage: 1.7, id: '5-7' },
      { name: '8–10', value: 401, percentage: 31.1, id: '8-10' },
      { name: '11–13', value: 545, percentage: 42.2, id: '11-13' },
      { name: '14–16', value: 259, percentage: 20.1, id: '14-16' },
      { name: '17+', value: 64, percentage: 5.0, id: '17+' },
      { name: 'None', value: 0, percentage: 0, id: 'none' },
    ])
  })

  it('is empty when there are no campers at all', () => {
    expect(transformAgeData(undefined)).toEqual([])
    expect(transformAgeData(BY_AGE.map((b) => ({ ...b, count: 0, percentage: 0 })))).toEqual([])
  })
})

describe('AgeChart', () => {
  it('draws one bar per band with its count above it and the band below', () => {
    render(<AgeChart title="Enrollment by Age" data={BY_AGE} />)
    expect(screen.getByText('Enrollment by Age')).toBeInTheDocument()
    for (const label of ['5–7', '8–10', '11–13', '14–16', '17+', 'None']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    for (const count of ['22', '401', '545', '259', '64']) {
      expect(screen.getByText(count)).toBeInTheDocument()
    }
    // None's 0 sits beside the y-axis's own 0.
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2)
  })

  it('says how many campers it counts, each once, marked with the age note and no hover', () => {
    const { container } = render(<AgeChart data={BY_AGE} />)
    const line = screen.getByText(/campers, each counted once\./)
    expect(line.textContent).toBe(`1,291 campers, each counted once.${AGE_NOTE}`)
    const sup = line.querySelector('sup')
    expect(sup?.textContent).toBe(String(AGE_NOTE))
    expect(sup?.hasAttribute('title')).toBe(false)
    expect(container.querySelector('[title]')).toBeNull()
  })

  it('opens the drill-down for an age band with its key as the value', () => {
    const onBarClick = vi.fn()
    render(<AgeChart data={BY_AGE} onBarClick={onBarClick} />)
    // The x-axis label sits outside the column button, so click the column by its count.
    fireEvent.click(screen.getByText('401').closest('button')!)
    expect(onBarClick).toHaveBeenCalledWith({ type: 'age_band', value: '8-10', label: 'Ages 8–10' })
  })

  it('names the None list for the missing birthdate', () => {
    const onBarClick = vi.fn()
    render(<AgeChart data={BY_AGE} onBarClick={onBarClick} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(6)
    fireEvent.click(buttons[5]!)
    expect(onBarClick).toHaveBeenCalledWith({
      type: 'age_band',
      value: 'none',
      label: 'No Birthdate',
      titleFormat: 'adjective',
    })
  })

  it('has no clickable bars without a drill-down (the compare-year chart)', () => {
    render(<AgeChart data={BY_AGE} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('shows the empty state when no campers are counted', () => {
    render(<AgeChart data={[]} />)
    expect(screen.getByText('No data available')).toBeInTheDocument()
    expect(screen.queryByText(/each counted once/)).toBeNull()
  })
})

describe('AGE_NOTES', () => {
  it('says age is the season year minus the birth year, with the late-2016 example, and what None is', () => {
    expect(AGE_NOTES).toEqual([
      {
        n: AGE_NOTE,
        text: 'Age is the season year minus the birth year, so a camper born in late 2016 counts as 10 all through 2026. None means CampMinder has no birthdate for the camper.',
      },
    ])
  })
})
