/**
 * The household page's Income with two answer sets, labelled by form (adult aid form design GF-2 B; mock v2 step 22).
 * A household where an adult filed the adult aid form shows CampMinder's set under its band, and the adult's own set
 * under the adult aid form's band, each naming the requests it prices. A household with one form keeps today's
 * one-form table. Fictional names.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { ApiAidAnswer } from '../../../types/api-types'
import { gridRow, ROW_EMMA } from '../requests/gridFixtures'
import { householdPage, householdRequest } from './householdFixtures'
import { IncomePanel } from './HouseholdSections'

const answer = (field: string, value: string): ApiAidAnswer => ({
  field,
  synced: value,
  effective: value,
  corrected: false,
  changed_since_correction: false,
  history: [],
})

const PROGRAMS = { summer: 'At Camp', adult_weekend: 'Adult Weekends' }

const MIA = gridRow({
  request_id: 'reqmia000000001',
  person_cm_id: 1000003,
  camper_name: 'Mia Johnson',
  program_key: 'adult_weekend',
  session_name: "Women's Weekend",
})

const TWO_FORMS = householdPage({
  requests: [
    householdRequest(ROW_EMMA),
    householdRequest(MIA, {
      answers_source: 'google_form',
      own_answers: [
        answer('total_gross_income', '104000.00'),
        answer('expected_gross_income', '100000.00'),
        answer('total_medical_expenses', '3200.00'),
        answer('non_retirement_savings', '40000.00'),
      ],
      form_submitted_at: '2026-11-05T17:00:00Z',
    }),
  ],
})

describe('IncomePanel: one answer set per form (GF-2 B)', () => {
  it("labels CampMinder's set with the requests it prices", () => {
    render(<IncomePanel page={TWO_FORMS} programs={PROGRAMS} />)
    const band = document.querySelector('[data-answer-set="campminder"]') as HTMLElement
    expect(within(band).getByText('CM form')).toBeInTheDocument()
    expect(band).toHaveTextContent('CampMinder aid form')
    expect(band).toHaveTextContent("prices Emma's At Camp request")
  })

  it("labels the adult's own set with who filed it, when, and its request, then its figures", () => {
    render(<IncomePanel page={TWO_FORMS} programs={PROGRAMS} />)
    const band = document.querySelector('[data-answer-set="google_form"]') as HTMLElement
    expect(within(band).getByText('adult aid form')).toBeInTheDocument()
    expect(band).toHaveTextContent('Adult aid form')
    expect(band).toHaveTextContent("Mia Johnson, Nov 5 · prices Mia's Adult Weekends request")
    const set = band.closest('table') as HTMLElement
    // Its own heads, so the form's figure and the one used read apart when CampMinder's set shows no table above it.
    expect([...set.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'Answer',
      "Form's answer",
      'Using',
      '',
      '',
    ])
    expect(within(set).getAllByText('$104,000').length).toBeGreaterThan(0)
    expect(within(set).getAllByText('$40,000').length).toBeGreaterThan(0)
  })

  it("shows the adult set's priced figures first, the rest behind a toggle (mock v2 step 22)", async () => {
    const many = householdPage({
      requests: [
        householdRequest(MIA, {
          answers_source: 'google_form',
          own_answers: [
            answer('total_gross_income', '104000.00'),
            answer('expected_gross_income', '100000.00'),
            answer('total_medical_expenses', '3200.00'),
            answer('non_retirement_savings', '40000.00'),
            answer('total_rent', '26400.00'),
            answer('unemployment', 'false'),
          ],
          form_submitted_at: '2026-11-05T17:00:00Z',
        }),
      ],
    })
    render(<IncomePanel page={many} programs={PROGRAMS} />)
    const set = document.querySelector('[data-own-answers]') as HTMLElement
    expect(within(set).queryByText('Rent')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '2 more answers ▸' }))
    expect(within(set).getByText('Rent')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Show Only the Priced Figures ▴' })
    ).toBeInTheDocument()
  })

  it('a household with one form keeps the one-form table, no bands', () => {
    render(<IncomePanel page={householdPage()} />)
    expect(document.querySelector('[data-answer-set]')).toBeNull()
    expect(screen.getByText("Family's answer")).toBeInTheDocument()
  })

  it('an adult aid form set shows even when the household filed no CampMinder form', () => {
    render(<IncomePanel page={{ ...TWO_FORMS, incomes: [] }} programs={PROGRAMS} />)
    expect(screen.queryByText('No income form on file.')).toBeNull()
    expect(document.querySelector('[data-answer-set="google_form"]')).not.toBeNull()
  })
})
