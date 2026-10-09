/**
 * Cut (design-language §13; kit .cf-cut / CF.cut): text that may be cut by its column truncates with
 * an ellipsis and always carries a native title with the full words.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Cut } from './Cut'

describe('Cut', () => {
  it('truncates on one line and titles itself with its own words', () => {
    render(<Cut text="Iris Brennan-Alvarez & Sam Brennan-Alvarez" />)
    const cut = screen.getByText('Iris Brennan-Alvarez & Sam Brennan-Alvarez')
    expect(cut).toHaveClass('truncate', 'max-w-full')
    expect(cut).toHaveAttribute('title', 'Iris Brennan-Alvarez & Sam Brennan-Alvarez')
  })

  it('takes a fuller title when the visible words are a short form', () => {
    render(<Cut text="FC2" title="Family Camp 2" />)
    expect(screen.getByText('FC2')).toHaveAttribute('title', 'Family Camp 2')
  })
})
