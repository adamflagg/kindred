/**
 * The Waitlist and Cancellations nested donuts (#2898): the inner ring lists every gender identity label in the
 * fixed order (#76 a) with the kit's colour tokens, and the outer ring wears the same colour as its gender at the
 * part's opacity (the kit's colours are hex and var(), so shading by parsing an HSL string no longer works).
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NestedGenderDonut } from './NestedGenderDonut'
import { nestedGenderRings } from './nestedGenderRings'
import { WaitlistGenderChart } from './WaitlistGenderChart'
import { CancellationGenderChart } from './CancellationGenderChart'
import {
  GENDER_BOY_MAN,
  GENDER_GIRL_WOMAN,
  GENDER_NOT_GIVEN,
  GENDER_TRANSGENDER_BOY_MAN,
} from '../camperships/kit/genderIdentity'
import type { GenderBreakdown } from '../../types/metrics'

const PARTS = [
  { key: 'no_enrollment', label: 'No Other Sessions', opacity: 1 },
  { key: 'has_enrollment', label: 'Has Other Sessions', opacity: 0.5 },
] as const

const data: GenderBreakdown[] = [
  { gender: 'not given', count: 1, percentage: 10, no_enrollment: 1, has_enrollment: 0 },
  { gender: 'Boy/man', count: 4, percentage: 40, no_enrollment: 1, has_enrollment: 3 },
  { gender: 'Transgender boy/man', count: 1, percentage: 10, no_enrollment: 0, has_enrollment: 1 },
  { gender: 'Girl/woman', count: 4, percentage: 40, no_enrollment: 3, has_enrollment: 1 },
]

describe('nestedGenderRings', () => {
  it('orders the inner ring by the fixed identity order, with display names and kit colours', () => {
    const { inner } = nestedGenderRings(data, PARTS)
    expect(inner.map((d) => [d.name, d.gender, d.color])).toEqual([
      ['Girl/woman', 'Girl/woman', GENDER_GIRL_WOMAN],
      ['Boy/man', 'Boy/man', GENDER_BOY_MAN],
      ['Transgender boy/man', 'Transgender boy/man', GENDER_TRANSGENDER_BOY_MAN],
      ['Not given', 'not given', GENDER_NOT_GIVEN],
    ])
  })

  it('shades the outer ring by opacity on the gender colour, skipping empty parts', () => {
    const { outer } = nestedGenderRings(data, PARTS)
    expect(outer.slice(0, 3).map((d) => [d.name, d.value, d.color, d.opacity])).toEqual([
      ['Girl/woman · No Other Sessions', 3, GENDER_GIRL_WOMAN, 1],
      ['Girl/woman · Has Other Sessions', 1, GENDER_GIRL_WOMAN, 0.5],
      ['Boy/man · No Other Sessions', 1, GENDER_BOY_MAN, 1],
    ])
  })

  it('puts what the parts leave uncounted into the remainder part', () => {
    const rows: GenderBreakdown[] = [{ gender: 'Girl/woman', count: 5, percentage: 100 }]
    const unknown = { key: 'unknown', label: 'Unknown Status', opacity: 1, color: GENDER_NOT_GIVEN }
    expect(nestedGenderRings(rows, PARTS, unknown).outer).toEqual([
      expect.objectContaining({ value: 5, color: GENDER_NOT_GIVEN, part: 'Unknown Status' }),
    ])
  })
})

describe('NestedGenderDonut', () => {
  it('lists every label in the legend by display name, then the parts', () => {
    render(<NestedGenderDonut data={data} parts={PARTS} title="Gender Distribution" />)
    const legend = [...document.querySelectorAll('span')].map((s) => s.textContent)
    expect(legend).toEqual(
      expect.arrayContaining(['Girl/woman', 'Boy/man', 'Transgender boy/man', 'Not given'])
    )
    expect(legend.indexOf('Girl/woman')).toBeLessThan(legend.indexOf('Not given'))
    expect(screen.getByText('Has Other Sessions')).toBeInTheDocument()
  })

  it('shows its footer line', () => {
    render(<NestedGenderDonut data={data} parts={PARTS} footer={<p>the note line</p>} />)
    expect(screen.getByText('the note line')).toBeInTheDocument()
  })
})

describe('the two tabs keep their parts and pass the footer through', () => {
  it('Waitlist', () => {
    render(<WaitlistGenderChart data={data} footer={<p>waitlist line</p>} />)
    expect(screen.getByText('No Other Sessions')).toBeInTheDocument()
    expect(screen.getByText('waitlist line')).toBeInTheDocument()
    expect(screen.getByText('Not given')).toBeInTheDocument()
  })

  it('Cancellations', () => {
    const rows: GenderBreakdown[] = [
      { gender: 'Girl/woman', count: 3, percentage: 75, was_enrolled: 1, was_waitlisted: 1 },
      { gender: 'self-described', count: 1, percentage: 25, was_applied: 1 },
    ]
    render(<CancellationGenderChart data={rows} footer={<p>cancel line</p>} />)
    expect(screen.getByText('Was Enrolled')).toBeInTheDocument()
    expect(screen.getByText('Unknown Status')).toBeInTheDocument()
    expect(screen.getByText('Self-described')).toBeInTheDocument()
    expect(screen.getByText('cancel line')).toBeInTheDocument()
  })
})
