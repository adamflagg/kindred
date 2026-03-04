import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Module export
// ---------------------------------------------------------------------------
describe('ChartLegend exports', () => {
  it('should export ChartLegend as a named function', async () => {
    const mod = await import('./ChartLegend')
    expect(typeof mod.ChartLegend).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
describe('ChartLegend rendering', () => {
  let ChartLegend: typeof import('./ChartLegend').ChartLegend

  beforeAll(async () => {
    const mod = await import('./ChartLegend')
    ChartLegend = mod.ChartLegend
  })

  it('should render one swatch per item', () => {
    const items = [
      { label: 'Red', color: '#f00' },
      { label: 'Blue', color: '#00f' },
      { label: 'Green', color: '#0f0' },
    ]
    render(<ChartLegend items={items} />)
    expect(screen.getByText('Red')).toBeInTheDocument()
    expect(screen.getByText('Blue')).toBeInTheDocument()
    expect(screen.getByText('Green')).toBeInTheDocument()
  })

  it('should apply swatch background color from items', () => {
    const items = [{ label: 'Teal', color: 'rgb(0, 128, 128)' }]
    const { container } = render(<ChartLegend items={items} />)
    const swatch = container.querySelector('.rounded-sm')
    expect(swatch).not.toBeNull()
    expect((swatch as HTMLElement).style.backgroundColor).toBe('rgb(0, 128, 128)')
  })

  it('should render empty when items is empty', () => {
    const { container } = render(<ChartLegend items={[]} />)
    const spans = container.querySelectorAll('span')
    expect(spans.length).toBe(0)
  })

  it('should use text-sm for <= 6 items (normal mode)', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      label: `Item ${i}`,
      color: '#000',
    }))
    const { container } = render(<ChartLegend items={items} />)
    const labels = container.querySelectorAll('span')
    for (const label of labels) {
      expect(label.className).toContain('text-sm')
      expect(label.className).not.toContain('text-xs')
    }
  })

  it('should use text-xs for > 6 items (compact mode)', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      label: `Item ${i}`,
      color: '#000',
    }))
    const { container } = render(<ChartLegend items={items} />)
    const labels = container.querySelectorAll('span')
    for (const label of labels) {
      expect(label.className).toContain('text-xs')
      expect(label.className).not.toContain('text-sm')
    }
  })

  it('should apply custom className', () => {
    const { container } = render(
      <ChartLegend items={[{ label: 'A', color: '#000' }]} className="mt-4" />
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('mt-4')
  })
})
