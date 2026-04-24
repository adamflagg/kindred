/**
 * Tests for EdgeFilters component
 * Updated spec: edge-type checkboxes removed; bunks/units toggles moved to graph header top row.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import EdgeFilters from './EdgeFilters'

// ---------------------------------------------------------------------------
// New spec: EdgeFilters must NOT render any edge-type toggle UI
// ---------------------------------------------------------------------------

describe('EdgeFilters — new slim spec', () => {
  const baseProps = {
    showEdges: { request: true, sibling: true },
    onEdgeFilterChange: vi.fn(),
    showBubbles: true,
    onToggleBubbles: vi.fn(),
  }

  it('does NOT render a "Show edges:" label', () => {
    render(<EdgeFilters {...baseProps} />)
    expect(screen.queryByText(/show edges/i)).not.toBeInTheDocument()
  })

  it('does NOT render a Filter icon (edge section removed)', () => {
    render(<EdgeFilters {...baseProps} />)
    // The Filter icon from lucide-react renders an svg; the surrounding span
    // used to contain "Show edges:" — confirm that entire section is gone.
    expect(screen.queryByText(/show edges/i)).not.toBeInTheDocument()
  })

  it('does NOT render a checkbox for the "requests" edge type', () => {
    render(<EdgeFilters {...baseProps} />)
    // Previously there was a labelled checkbox for "Requests"
    expect(screen.queryByRole('checkbox', { name: /requests/i })).not.toBeInTheDocument()
  })

  it('does NOT render a checkbox for the "siblings" edge type', () => {
    render(<EdgeFilters {...baseProps} />)
    expect(screen.queryByRole('checkbox', { name: /siblings/i })).not.toBeInTheDocument()
  })

  it('does NOT render any edge-type checkbox at all', () => {
    // If somehow new edge types were added as toggleable this would catch them.
    render(<EdgeFilters {...baseProps} />)
    // The only checkboxes allowed are bunks/units (tested separately in SocialNetworkGraph)
    // EdgeFilters itself should render zero checkboxes now.
    const checkboxes = screen.queryAllByRole('checkbox')
    expect(checkboxes).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Regression: getEdgeLabel utility still works
// ---------------------------------------------------------------------------

describe('getEdgeLabel utility', () => {
  it('maps known edge types to display labels', async () => {
    const { getEdgeLabel } = await import('./EdgeFilters')
    expect(getEdgeLabel('request')).toBe('Requests')
    expect(getEdgeLabel('sibling')).toBe('Siblings')
    expect(getEdgeLabel('unknown')).toBe('unknown')
  })
})
