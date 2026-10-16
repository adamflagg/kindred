import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
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

  describe('Gender picker (#2898 owner answer #78)', () => {
    const withPicker = {
      ...defaultProps,
      genderBasis: 'field' as const,
      onGenderBasisChange: vi.fn(),
    }

    it('is hidden until Split by gender is on', () => {
      render(<VelocityControls {...withPicker} />)
      expect(screen.queryByRole('group', { name: 'Gender' })).toBeNull()
    })

    it('offers Gender field and Gender identity, Gender field lit by default', () => {
      render(<VelocityControls {...withPicker} splitByGender />)
      const picker = screen.getByRole('group', { name: 'Gender' })
      expect(within(picker).getByRole('button', { name: 'Gender field' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(within(picker).getByRole('button', { name: 'Gender identity' })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
    })

    it('switches to Gender identity', () => {
      const onChange = vi.fn()
      render(<VelocityControls {...withPicker} splitByGender onGenderBasisChange={onChange} />)
      fireEvent.click(screen.getByRole('button', { name: 'Gender identity' }))
      expect(onChange).toHaveBeenCalledWith('identity')
    })

    // Unlike the Requests Round filter it is styled on, the picker never clears: one value, always.
    it('keeps the lit option when it is clicked again', () => {
      const onChange = vi.fn()
      render(<VelocityControls {...withPicker} splitByGender onGenderBasisChange={onChange} />)
      const lit = screen.getByRole('button', { name: 'Gender field' })
      fireEvent.click(lit)
      expect(onChange).not.toHaveBeenCalled()
      expect(lit).toHaveAttribute('aria-pressed', 'true')
    })
  })
})
