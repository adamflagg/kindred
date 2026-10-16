import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricSortHeader } from './MetricSortHeader'

function header(props: Partial<Parameters<typeof MetricSortHeader>[0]>) {
  render(
    <table>
      <thead>
        <tr>
          <MetricSortHeader label="Count" direction={null} onSort={() => {}} {...props} />
        </tr>
      </thead>
    </table>
  )
  return screen.getByRole('button', { name: /^Count/ })
}

describe('MetricSortHeader alignment (#3207 PR 10 scan)', () => {
  it('a bare header follows its column: right over numbers', () => {
    expect(header({ bare: true, align: 'right' }).className).toContain('justify-end')
  })

  it('a bare header follows its column: left over names', () => {
    const button = header({ bare: true, align: 'left' })
    expect(button.className).not.toContain('justify-center')
    expect(button.className).not.toContain('justify-end')
  })

  it('a bare header can centre over a grouped band', () => {
    expect(header({ bare: true, align: 'center' }).className).toContain('justify-center')
  })

  it('the default look keeps a number header on the right', () => {
    expect(header({}).className).toContain('justify-end')
  })
})
