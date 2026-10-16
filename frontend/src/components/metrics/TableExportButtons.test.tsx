import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TableExportButtons } from './TableExportButtons'

const download = vi.hoisted(() => vi.fn())
vi.mock('../../utils/csvExport', async (orig) => ({
  ...(await orig<typeof import('../../utils/csvExport')>()),
  downloadCsv: download,
}))

describe('TableExportButtons', () => {
  beforeEach(() => {
    download.mockClear()
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  const props = {
    filename: '2026-session-details-2026-10-15.csv',
    headers: ['Session', 'Enrolled', 'Capacity'],
    rows: [
      ['Session 2', 312, null],
      ['Total', 312, 0],
    ],
  }

  it('downloads the rows as shown, numbers as numbers and blanks as empty cells', () => {
    render(<TableExportButtons {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
    expect(download).toHaveBeenCalledWith(
      'Session,Enrolled,Capacity\nSession 2,312,\nTotal,312,0',
      '2026-session-details-2026-10-15.csv'
    )
  })

  it('copies the same table tab-separated and says so', async () => {
    render(<TableExportButtons {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /^copy/i }))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'Session\tEnrolled\tCapacity\nSession 2\t312\t\nTotal\t312\t0'
      )
    )
    expect(await screen.findByText(/Copied/)).toBeInTheDocument()
  })
})
