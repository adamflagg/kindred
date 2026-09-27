import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Pagination } from './Pagination'
import { pageWindow } from './paginationParts'

function renderPager(page: number, total: number, perPage = 10) {
  const onPageChange = vi.fn()
  const onPerPageChange = vi.fn()
  render(
    <Pagination
      page={page}
      perPage={perPage}
      total={total}
      perPageOptions={[10, 15, 25]}
      previousLabel="← Newer"
      nextLabel="Older →"
      onPageChange={onPageChange}
      onPerPageChange={onPerPageChange}
    />
  )
  return { onPageChange, onPerPageChange }
}

describe('Pagination', () => {
  it('says which rows are showing and offers the rows-per-page choices', () => {
    renderPager(1, 42)
    expect(screen.getByText(/1–10 of 42/)).toBeTruthy()
    const select = screen.getByRole('combobox')
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      '10',
      '15',
      '25',
    ])
  })

  it('the last page shows a short range', () => {
    renderPager(5, 42)
    expect(screen.getByText(/41–42 of 42/)).toBeTruthy()
  })

  it('Newer is off on the first page and Older on the last', () => {
    renderPager(1, 42)
    expect(screen.getByRole('button', { name: '← Newer' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Older →' })).toHaveProperty('disabled', false)
  })

  it('moves by button and by page number', () => {
    const { onPageChange } = renderPager(2, 42)
    fireEvent.click(screen.getByRole('button', { name: 'Older →' }))
    fireEvent.click(screen.getByRole('button', { name: '← Newer' }))
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    expect(onPageChange.mock.calls).toEqual([[3], [1], [4]])
  })

  it('marks the current page with the primary fill', () => {
    renderPager(2, 42)
    expect(screen.getByRole('button', { name: '2' }).className).toContain('bg-primary')
    expect(screen.getByRole('button', { name: '3' }).className).not.toContain('bg-primary')
  })

  it('reports a rows-per-page change', () => {
    const { onPerPageChange } = renderPager(1, 42)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '25' } })
    expect(onPerPageChange).toHaveBeenCalledWith(25)
  })

  it('renders nothing when there is nothing to page', () => {
    renderPager(1, 0)
    expect(screen.queryByTestId('pagination')).toBeNull()
  })
})

describe('pageWindow', () => {
  it('lists every page up to seven', () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps the ends and the neighbours, with gaps, beyond seven', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 'gap', 20])
    expect(pageWindow(10, 20)).toEqual([1, 'gap', 9, 10, 11, 'gap', 20])
    expect(pageWindow(20, 20)).toEqual([1, 'gap', 19, 20])
  })
})
