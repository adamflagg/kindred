import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { WaitlistGradePopover } from './WaitlistGradePopover'

describe('WaitlistGradePopover', () => {
  const persons = [
    { person_id: 1, first_name: 'Emma', last_name: 'Johnson', position: 4, grade: 4 },
    { person_id: 2, first_name: 'Olivia', last_name: 'Chen', position: 9, grade: 4 },
  ]

  it('renders grade-filtered header', () => {
    render(
      <WaitlistGradePopover
        isOpen={true}
        anchorRect={{ top: 100, left: 100, width: 50, height: 30 }}
        grade={4}
        genderLabel="girls"
        persons={persons}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText(/2 waitlisted 4th-grade girls/)).toBeInTheDocument()
  })

  it('shows all names with position numbers', () => {
    render(
      <WaitlistGradePopover
        isOpen={true}
        anchorRect={{ top: 100, left: 100, width: 50, height: 30 }}
        grade={4}
        genderLabel="girls"
        persons={persons}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText(/#4/)).toBeInTheDocument()
    expect(screen.getByText(/#9/)).toBeInTheDocument()
  })

  it('closes on Escape key', () => {
    const onClose = vi.fn()
    render(
      <WaitlistGradePopover
        isOpen={true}
        anchorRect={{ top: 100, left: 100, width: 50, height: 30 }}
        grade={4}
        genderLabel="girls"
        persons={persons}
        onClose={onClose}
      />
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('returns null when not open', () => {
    const { container } = render(
      <WaitlistGradePopover
        isOpen={false}
        anchorRect={{ top: 0, left: 0, width: 0, height: 0 }}
        grade={4}
        genderLabel="girls"
        persons={[]}
        onClose={vi.fn()}
      />
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows footer note about position numbering', () => {
    render(
      <WaitlistGradePopover
        isOpen={true}
        anchorRect={{ top: 100, left: 100, width: 50, height: 30 }}
        grade={4}
        genderLabel="girls"
        persons={persons}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText(/position.*session waitlist order/i)).toBeInTheDocument()
  })

  it('uses preferred name when available', () => {
    const personsWithPref = [
      {
        person_id: 1,
        first_name: 'Elizabeth',
        last_name: 'Smith',
        preferred_name: 'Liz',
        position: 4,
        grade: 4,
      },
    ]
    render(
      <WaitlistGradePopover
        isOpen={true}
        anchorRect={{ top: 100, left: 100, width: 50, height: 30 }}
        grade={4}
        genderLabel="girls"
        persons={personsWithPref}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText(/Liz S\./)).toBeInTheDocument()
  })
})
