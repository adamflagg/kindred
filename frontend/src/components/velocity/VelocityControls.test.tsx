import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VelocityControls } from './VelocityControls'

describe('VelocityControls', () => {
  const defaultProps = {
    priorYearOptions: [2025, 2024, 2023],
    selectedPriorYears: [] as number[],
    splitByGender: false,
    onTogglePriorYear: vi.fn(),
    onToggleGender: vi.fn(),
  }

  it('renders prior year checkboxes', () => {
    render(<VelocityControls {...defaultProps} />)
    expect(screen.getByText('2025')).toBeInTheDocument()
    expect(screen.getByText('2024')).toBeInTheDocument()
    expect(screen.getByText('2023')).toBeInTheDocument()
  })

  it('renders at most 5 prior year checkboxes', () => {
    render(
      <VelocityControls {...defaultProps} priorYearOptions={[2025, 2024, 2023, 2022, 2021, 2020]} />
    )
    expect(screen.queryByText('2020')).not.toBeInTheDocument()
  })

  it('checks selected prior years', () => {
    render(<VelocityControls {...defaultProps} selectedPriorYears={[2025]} />)
    const checkbox = screen.getByRole('checkbox', { name: '2025' })
    expect(checkbox).toBeChecked()
  })

  it('calls onTogglePriorYear when checkbox clicked', () => {
    const onToggle = vi.fn()
    render(<VelocityControls {...defaultProps} onTogglePriorYear={onToggle} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '2025' }))
    expect(onToggle).toHaveBeenCalledWith(2025)
  })

  it('renders gender split toggle', () => {
    render(<VelocityControls {...defaultProps} />)
    expect(screen.getByText('Split by gender')).toBeInTheDocument()
  })

  it('calls onToggleGender with checked state', () => {
    const onToggle = vi.fn()
    render(<VelocityControls {...defaultProps} onToggleGender={onToggle} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Split by gender' }))
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('disables unselected prior year checkboxes when gender split is on and one is selected', () => {
    render(<VelocityControls {...defaultProps} splitByGender={true} selectedPriorYears={[2025]} />)
    const checkbox2024 = screen.getByRole('checkbox', { name: '2024' })
    expect(checkbox2024).toBeDisabled()
  })

  it('shows limitation message when gender split is on', () => {
    render(<VelocityControls {...defaultProps} splitByGender={true} />)
    expect(screen.getByText('Limited to 1 prior year when gender split is on')).toBeInTheDocument()
  })

  it('renders extraControls slot', () => {
    render(<VelocityControls {...defaultProps} extraControls={<button>Extra</button>} />)
    expect(screen.getByText('Extra')).toBeInTheDocument()
  })

  it('hides prior year section when no options available', () => {
    render(<VelocityControls {...defaultProps} priorYearOptions={[]} />)
    expect(screen.queryByText('Compare with prior years')).not.toBeInTheDocument()
  })
})
