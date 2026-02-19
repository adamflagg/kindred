/**
 * TDD Tests for SectionDivider component.
 *
 * Tests are written FIRST before implementation (TDD).
 * This component renders a horizontal rule with an inset label,
 * used to group sections on metrics pages.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SectionDivider } from './SectionDivider'

describe('SectionDivider', () => {
  it('should render the label text', () => {
    render(<SectionDivider label="Camper Demographics" />)
    expect(screen.getByText('Camper Demographics')).toBeInTheDocument()
  })

  it('should render the label in uppercase', () => {
    render(<SectionDivider label="Session Analysis" />)
    const label = screen.getByText('Session Analysis')
    expect(label).toHaveClass('uppercase')
  })

  it('should have a top border for the divider line', () => {
    const { container } = render(<SectionDivider label="Test" />)
    const divider = container.firstElementChild
    expect(divider).toHaveClass('border-t')
  })

  it('should position the label over the border', () => {
    render(<SectionDivider label="Test" />)
    const label = screen.getByText('Test')
    expect(label).toHaveClass('absolute')
    expect(label).toHaveClass('-top-3')
  })

  it('should use theme-aware background and text colors', () => {
    render(<SectionDivider label="Test" />)
    const label = screen.getByText('Test')
    expect(label).toHaveClass('bg-background')
    expect(label).toHaveClass('text-muted-foreground')
  })

  it('should apply vertical spacing', () => {
    const { container } = render(<SectionDivider label="Test" />)
    const divider = container.firstElementChild
    expect(divider).toHaveClass('my-8')
    expect(divider).toHaveClass('pt-6')
  })
})
