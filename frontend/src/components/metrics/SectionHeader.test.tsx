import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Users, Calendar } from 'lucide-react'
import { SectionHeader } from './SectionHeader'

describe('SectionHeader', () => {
  it('should render the title text', () => {
    render(<SectionHeader icon={Users} title="Demographics" />)
    expect(screen.getByText('Demographics')).toBeInTheDocument()
  })

  it('should render as an h2 heading', () => {
    render(<SectionHeader icon={Users} title="Demographics" />)
    expect(screen.getByRole('heading', { level: 2, name: /Demographics/ })).toBeInTheDocument()
  })

  it('should render the icon', () => {
    const { container } = render(<SectionHeader icon={Users} title="Demographics" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveClass('text-primary')
  })

  it('should render description when provided', () => {
    render(
      <SectionHeader
        icon={Calendar}
        title="Session Enrollment"
        description="Enrollment across sessions and lengths"
      />
    )
    expect(screen.getByText('Enrollment across sessions and lengths')).toBeInTheDocument()
  })

  it('should not render description paragraph when not provided', () => {
    const { container } = render(<SectionHeader icon={Users} title="Demographics" />)
    expect(container.querySelector('p')).not.toBeInTheDocument()
  })

  it('should not have a border line', () => {
    const { container } = render(<SectionHeader icon={Users} title="Demographics" />)
    const wrapper = container.firstElementChild
    expect(wrapper).not.toHaveClass('border-t')
  })
})
