/**
 * SessionFlowSankey - Sankey flow diagram showing session-to-session transitions.
 *
 * Visualizes how campers flow from base year sessions to compare year sessions
 * (or "Did Not Return"). Nodes with the same CampMinder session ID share a color
 * across source and target sides. Links are colored by source session.
 */

import { useState, useMemo } from 'react'
import { Sankey, Tooltip, ResponsiveContainer } from 'recharts'
import type { SankeyData } from '../../utils/retentionTransforms'

// Unified palette: each cm_id gets one color regardless of source/target side
const SESSION_COLORS = [
  '#059669',
  '#2563eb',
  '#7c3aed',
  '#d97706',
  '#dc2626',
  '#0891b2',
  '#c026d3',
  '#65a30d',
]
const DID_NOT_RETURN_COLOR = '#9ca3af'

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

/** Props passed by Recharts to custom link renderer */
interface SankeyLinkProps {
  sourceX: number
  sourceY: number
  sourceControlX: number
  targetX: number
  targetY: number
  targetControlX: number
  linkWidth: number
  index: number
  payload: { source: number; target: number; value: number }
}

interface SessionFlowSankeyProps {
  data: SankeyData
  title: string
}

export function SessionFlowSankey({ data, title }: SessionFlowSankeyProps) {
  const [hoveredLinkIndex, setHoveredLinkIndex] = useState<number | null>(null)

  const sourceCount = new Set(data.links.map((l) => l.source)).size
  const height = Math.max(500, sourceCount * 100)

  // Build a unified color map: cm_id -> color, applied to both sides
  const colorMap = useMemo(() => {
    const map = new Map<number, string>()
    const cmIdToColor = new Map<number, string>()
    let colorIdx = 0

    // Assign colors by cm_id (first appearance order)
    for (const node of data.nodes) {
      const cmId = node.cmId
      if (cmId == null) continue
      if (!cmIdToColor.has(cmId)) {
        cmIdToColor.set(cmId, SESSION_COLORS[colorIdx % SESSION_COLORS.length] ?? '#059669')
        colorIdx++
      }
    }

    // Map node index -> color
    data.nodes.forEach((node, idx) => {
      if (node.cmId == null) {
        map.set(idx, DID_NOT_RETURN_COLOR)
      } else {
        map.set(idx, cmIdToColor.get(node.cmId) ?? DID_NOT_RETURN_COLOR)
      }
    })

    return map
  }, [data])

  return (
    <div className="card-lodge p-4">
      <h3 className="text-foreground mb-4 text-base font-semibold">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <Sankey
          data={data}
          nodeWidth={14}
          nodePadding={24}
          margin={{ top: 10, right: 160, bottom: 10, left: 160 }}
          link={
            // Recharts Sankey passes link geometry props that don't match its own types
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ((props: any) => {
              const {
                sourceX,
                sourceY,
                sourceControlX,
                targetX,
                targetY,
                targetControlX,
                linkWidth,
                index,
                payload,
              } = props as SankeyLinkProps
              const strokeColor = colorMap.get(payload.source) ?? '#d1d5db'

              let opacity = 0.3
              if (hoveredLinkIndex !== null) {
                opacity = index === hoveredLinkIndex ? 0.7 : 0.1
              }

              return (
                <path
                  d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={linkWidth}
                  strokeOpacity={opacity}
                  style={{ transition: 'stroke-opacity 0.15s ease' }}
                  onMouseEnter={() => setHoveredLinkIndex(index)}
                  onMouseLeave={() => setHoveredLinkIndex(null)}
                />
              )
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }) as any
          }
          node={({
            x,
            y,
            width,
            height: h,
            index,
          }: {
            x: number
            y: number
            width: number
            height: number
            index: number
          }) => {
            const name = data.nodes[index]?.name ?? ''
            const displayName = stripSuffix(name)
            const isSource = index < sourceCount
            const color = colorMap.get(index) ?? DID_NOT_RETURN_COLOR

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
