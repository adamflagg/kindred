/**
 * Decision 43 (#3207): the flow tooltip writes its camper count with a separator.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'
import { SessionFlowSankey } from './SessionFlowSankey'
import type { SankeyData } from '../../utils/retentionTransforms'

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Sankey: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ content }: { content: ReactElement }) =>
    cloneElement(content as ReactElement<Record<string, unknown>>, {
      active: true,
      payload: [{ payload: { source: 0, target: 1, value: 1293 } }],
    }),
}))

const data: SankeyData = {
  nodes: [
    { name: 'Session 1 (from)', cmId: 1000 },
    { name: 'Session 1 (to)', cmId: 1000 },
  ],
  links: [{ source: 0, target: 1, value: 1293 }],
}

describe('SessionFlowSankey tooltip', () => {
  it('writes the camper count with a separator', () => {
    render(<SessionFlowSankey data={data} title="Flow" />)
    expect(screen.getByText('1,293 campers')).toBeInTheDocument()
  })
})
