/**
 * SessionFlowSankey - Sankey flow diagram showing session-to-session transitions.
 *
 * Visualizes how campers flow from base year sessions to compare year sessions
 * (or "Did Not Return"), replacing the flat "Retention by Prior Session" bar chart.
 */

import { Sankey, Tooltip, ResponsiveContainer } from 'recharts'
import type { SankeyData } from '../../utils/retentionTransforms'

// Color palettes for source (left) and target (right) nodes
const SOURCE_COLORS = ['#059669', '#0d9488', '#0891b2', '#2563eb', '#7c3aed', '#c026d3']
const TARGET_COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899']
const DID_NOT_RETURN_COLOR = '#9ca3af'

function getNodeColor(name: string, index: number, sourceCount: number): string {
  if (name === 'Did Not Return') return DID_NOT_RETURN_COLOR
  if (index < sourceCount) return SOURCE_COLORS[index % SOURCE_COLORS.length]!
  return TARGET_COLORS[(index - sourceCount) % TARGET_COLORS.length]!
}

function stripSuffix(name: string): string {
  return name.replace(/ \(from\)$/, '').replace(/ \(to\)$/, '')
}

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{
    payload?: {
      source?: number
      target?: number
      value?: number
      payload?: { source?: number; target?: number; value?: number }
    }
  }>
  sankeyData: SankeyData
}

function SankeyTooltip({ active, payload, sankeyData }: CustomTooltipProps) {
  if (!active || !payload?.[0]) return null

  const data = payload[0].payload?.payload ?? payload[0].payload
  if (!data || data.source == null || data.target == null) return null

  const sourceName = stripSuffix(sankeyData.nodes[data.source]?.name ?? '')
  const targetName = stripSuffix(sankeyData.nodes[data.target]?.name ?? '')
  const value = data.value ?? 0

  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 text-sm shadow-md">
      <span className="font-medium">{sourceName}</span>
      <span className="text-muted-foreground mx-1">&rarr;</span>
      <span className="font-medium">{targetName}</span>
      <span className="text-muted-foreground ml-2">
        {value} camper{value !== 1 ? 's' : ''}
      </span>
    </div>
  )
}

interface SessionFlowSankeyProps {
  data: SankeyData
  title: string
}

export function SessionFlowSankey({ data, title }: SessionFlowSankeyProps) {
  const sourceCount = new Set(data.links.map((l) => l.source)).size
  const height = Math.max(350, sourceCount * 60)

  return (
    <div className="card-lodge p-4">
      <h3 className="text-foreground mb-4 text-sm font-medium">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <Sankey
          data={data}
          nodeWidth={14}
          nodePadding={24}
          margin={{ top: 10, right: 160, bottom: 10, left: 160 }}
          link={{ stroke: '#d1d5db', strokeOpacity: 0.5 }}
          node={({ x, y, width, height: h, index }: {
            x: number
            y: number
            width: number
            height: number
            index: number
          }) => {
            const name = data.nodes[index]?.name ?? ''
            const displayName = stripSuffix(name)
            const isSource = index < sourceCount
            const color = getNodeColor(name, index, sourceCount)

            return (
              <g>
                <rect x={x} y={y} width={width} height={h} fill={color} rx={2} />
                <text
                  x={isSource ? x - 6 : x + width + 6}
                  y={y + h / 2}
                  textAnchor={isSource ? 'end' : 'start'}
                  dominantBaseline="central"
                  className="fill-foreground text-xs"
                >
                  {displayName}
                </text>
              </g>
            )
          }}
        >
          <Tooltip content={<SankeyTooltip sankeyData={data} />} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  )
}
