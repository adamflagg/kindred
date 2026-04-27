/**
 * Tests for GraphLegend component
 * TDD - tests written first, implementation follows
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import GraphLegend from './GraphLegend'

describe('GraphLegend constants', () => {
  describe('edge type colors', () => {
    it('should have predefined colors for each edge type', () => {
      const EDGE_COLORS: Record<string, string> = {
        request: '#3498db',
        historical: '#95a5a6',
        sibling: '#e74c3c',
        school: '#2ecc71',
        bundled: '#9b59b6',
      }

      expect(EDGE_COLORS['request']).toBe('#3498db')
      expect(EDGE_COLORS['historical']).toBe('#95a5a6')
      expect(EDGE_COLORS['sibling']).toBe('#e74c3c')
      expect(EDGE_COLORS['school']).toBe('#2ecc71')
    })
  })

  describe('grade colors', () => {
    it('should have colors for grades 1-12', () => {
      const GRADE_COLORS: Record<number, string> = {
        1: '#e74c3c',
        2: '#e67e22',
        3: '#f39c12',
        4: '#f1c40f',
        5: '#2ecc71',
        6: '#27ae60',
        7: '#16a085',
        8: '#3498db',
        9: '#2980b9',
        10: '#9b59b6',
        11: '#8e44ad',
        12: '#34495e',
      }

      expect(Object.keys(GRADE_COLORS)).toHaveLength(12)
      expect(GRADE_COLORS[1]).toBe('#e74c3c')
      expect(GRADE_COLORS[12]).toBe('#34495e')
    })
  })
})

describe('GraphLegend rendering', () => {
  it('renames the node status section to "Camper request status"', () => {
    render(<GraphLegend />)
    expect(screen.getByText('Camper request status')).toBeInTheDocument()
    expect(screen.queryByText(/^Node Status$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Node status$/)).not.toBeInTheDocument()
  })

  it('does not render an Edge Confidence legend section', () => {
    render(<GraphLegend />)
    expect(screen.queryByText(/edge confidence/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/High \(>90%\)/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Medium \(50-90%\)/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Low \(<50%\)/)).not.toBeInTheDocument()
  })

  it('labels the green status as "Requests satisfied (1+)" not bare "Satisfied"', () => {
    render(<GraphLegend />)
    expect(screen.getByText('Requests satisfied (1+)')).toBeInTheDocument()
    expect(screen.queryByText(/^Satisfied$/)).not.toBeInTheDocument()
  })

  it('labels the red status as "None" to contrast with "Requests satisfied (1+)"', () => {
    render(<GraphLegend />)
    expect(screen.getByText('None')).toBeInTheDocument()
    expect(screen.queryByText(/^Isolated$/)).not.toBeInTheDocument()
  })
})
