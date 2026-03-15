import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { WaitlistTooltip } from './WaitlistTooltip'

describe('WaitlistTooltip', () => {
  const persons = [
    { person_id: 1, first_name: 'Emma', last_name: 'Johnson', position: 1, grade: 3 },
    { person_id: 2, first_name: 'Olivia', last_name: 'Chen', position: 2, grade: 4 },
    { person_id: 3, first_name: 'Sophia', last_name: 'Garcia', position: 3, grade: 6 },
  ]

  it('renders count header with gender label', () => {
    render(
      <WaitlistTooltip
        isVisible={true}
        position={{ x: 100, y: 100 }}
        totalCount={3}
        genderLabel="girls"
        persons={persons}
      />
    )
    expect(screen.getByText('3 girls on waitlist')).toBeInTheDocument()
  })

  it('shows all names when 5 or fewer', () => {
    render(
      <WaitlistTooltip
        isVisible={true}
        position={{ x: 100, y: 100 }}
        totalCount={3}
        genderLabel="girls"
        persons={persons}
      />
    )
    expect(screen.getByText(/Emma J\./)).toBeInTheDocument()
    expect(screen.queryByText(/click for full list/)).not.toBeInTheDocument()
  })

  it('shows top 5 with footer when more than 5 total', () => {
    const manyPersons = Array.from({ length: 5 }, (_, i) => ({
      person_id: i,
      first_name: `Girl${i}`,
      last_name: `Test${i}`,
      position: i + 1,
      grade: 3,
    }))
    render(
      <WaitlistTooltip
        isVisible={true}
        position={{ x: 100, y: 100 }}
        totalCount={12}
        genderLabel="girls"
        persons={manyPersons}
      />
    )
    expect(screen.getByText(/\+ 7 more/)).toBeInTheDocument()
  })

  it('returns null when not visible', () => {
    const { container } = render(
      <WaitlistTooltip
        isVisible={false}
        position={{ x: 0, y: 0 }}
        totalCount={3}
        genderLabel="girls"
        persons={persons}
      />
    )
    expect(container.innerHTML).toBe('')
  })

  it('uses preferred name when available', () => {
    const personsWithPref = [
      {
        person_id: 1,
        first_name: 'Elizabeth',
        last_name: 'Smith',
        preferred_name: 'Liz',
        position: 1,
        grade: 4,
      },
    ]
    render(
      <WaitlistTooltip
        isVisible={true}
        position={{ x: 100, y: 100 }}
        totalCount={1}
        genderLabel="girls"
        persons={personsWithPref}
      />
    )
    expect(screen.getByText(/Liz S\./)).toBeInTheDocument()
    expect(screen.queryByText(/Elizabeth/)).not.toBeInTheDocument()
  })
})
