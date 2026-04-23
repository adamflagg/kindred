/**
 * Tests for GraphHelp component
 * TDD - tests written first, implementation follows
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import GraphHelp from './GraphHelp'

describe('GraphHelp', () => {
  it('does not mention ego network', () => {
    render(<GraphHelp />)
    expect(screen.queryByText(/ego network/i)).not.toBeInTheDocument()
  })

  it('does not mention edge confidence / opacity encoding', () => {
    render(<GraphHelp />)
    expect(screen.queryByText(/higher confidence/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/more opaque/i)).not.toBeInTheDocument()
  })
})
