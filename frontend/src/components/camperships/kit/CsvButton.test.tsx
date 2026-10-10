/**
 * AidCsvButton and AidCopyButton (design-language §4; kit .cf-csv / .cf-split / CF.csv / CF.copy):
 * Download CSV is small, 26px at 12.5px on card white, the same on every page; Copy is the same
 * button. With a menu (Requests › Needs an offer › R1, the March File) it is a split button whose
 * caret part is 22px, not 50px.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AidCopyButton, AidCsvButton } from './CsvButton'

describe('AidCsvButton', () => {
  it('is the small 26px Download CSV button, and downloads on click', async () => {
    const onDownload = vi.fn()
    render(<AidCsvButton onDownload={onDownload} />)
    const button = screen.getByRole('button', { name: 'Download CSV' })
    expect(button).toHaveClass('h-[26px]', 'text-[12.5px]', 'bg-card')
    expect(button).not.toHaveClass('py-2')
    await userEvent.click(button)
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it('splits with a 22px caret when it has a menu; the caret opens the menu', async () => {
    render(<AidCsvButton onDownload={vi.fn()} menu={<button type="button">March File</button>} />)
    const caret = screen.getByRole('button', { name: 'More downloads' })
    expect(caret).toHaveClass('w-[22px]', 'h-[26px]')
    expect(screen.queryByTestId('csv-menu')).toBeNull()
    await userEvent.click(caret)
    const menu = screen.getByTestId('csv-menu')
    expect(menu).toHaveTextContent('This list, as filtered')
    expect(screen.getByRole('button', { name: 'March File' })).toBeInTheDocument()
  })

  it('closes its menu on Escape and on an outside press', async () => {
    render(
      <div>
        <span>outside</span>
        <AidCsvButton onDownload={vi.fn()} menu={<span>March File</span>} />
      </div>
    )
    await userEvent.click(screen.getByRole('button', { name: 'More downloads' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('csv-menu')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'More downloads' }))
    await userEvent.click(screen.getByText('outside'))
    expect(screen.queryByTestId('csv-menu')).toBeNull()
  })
})

describe('AidCopyButton', () => {
  it('is the same small button', async () => {
    const onCopy = vi.fn()
    render(<AidCopyButton onCopy={onCopy} />)
    const button = screen.getByRole('button', { name: 'Copy' })
    expect(button).toHaveClass('h-[26px]', 'text-[12.5px]', 'bg-card')
    await userEvent.click(button)
    expect(onCopy).toHaveBeenCalledTimes(1)
  })
})

describe('AidCopyButton once copied', () => {
  it('reads "✓ Copied" in place at a fixed width, so the row never moves', () => {
    const { rerender } = render(<AidCopyButton onCopy={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveClass('w-[80px]')
    rerender(<AidCopyButton onCopy={vi.fn()} copied />)
    const button = screen.getByRole('button', { name: '✓ Copied' })
    expect(button).toHaveClass('w-[80px]')
  })
})

describe('button titles', () => {
  it('carries a title on Copy and on Download CSV when the page says what each takes', () => {
    render(
      <>
        <AidCopyButton onCopy={vi.fn()} title="Copy the By tier table, to paste into a deck" />
        <AidCsvButton
          onDownload={vi.fn()}
          title="By tier · CSV, with this view's link on its last line"
        />
      </>
    )
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveAttribute(
      'title',
      'Copy the By tier table, to paste into a deck'
    )
    expect(screen.getByRole('button', { name: 'Download CSV' })).toHaveAttribute(
      'title',
      "By tier · CSV, with this view's link on its last line"
    )
  })

  it('can be off while there is nothing to copy yet', () => {
    render(<AidCopyButton onCopy={vi.fn()} disabled />)
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled()
  })
})
