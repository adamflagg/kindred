/**
 * ComparisonBarChart - Grouped bar chart showing two years per category.
 *
 * Merges primary and comparison datasets by name key and renders
 * side-by-side bars using Recharts.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LabelList,
} from 'recharts'

const PRIMARY_COLOR = 'hsl(160, 100%, 35%)'
const COMPARE_COLOR = 'hsl(160, 60%, 50%)'

interface ChartDataItem {
  name: string
  value: number
  percentage?: number
}

interface ComparisonBarChartProps {
  title: string
  primaryData: ChartDataItem[]
  comparisonData: ChartDataItem[]
  primaryYear: number
  compareYear: number
  height?: number
  className?: string
}

export function ComparisonBarChart({
  title,
  primaryData,
  comparisonData,
  primaryYear,
  compareYear,
  height = 300,
  className = '',
}: ComparisonBarChartProps) {
  if (primaryData.length === 0 && comparisonData.length === 0) {
    return (
      <div className={`card-lodge p-4 ${className}`}>
        <h3 className="text-foreground mb-4 text-base font-semibold">{title}</h3>
        <div className="text-muted-foreground flex h-[200px] items-center justify-center">
          No data available
        </div>
      </div>
    )
  }

  // Merge datasets by name
  const compareMap = new Map(comparisonData.map((d) => [d.name, d.value]))
  const allNames = new Set([
    ...primaryData.map((d) => d.name),
    ...comparisonData.map((d) => d.name),
  ])

  const mergedData = Array.from(allNames).map((name) => {
    const primary = primaryData.find((d) => d.name === name)
    return {
      name,
      [String(primaryYear)]: primary?.value ?? 0,
      [String(compareYear)]: compareMap.get(name) ?? 0,
    }
  })

  return (
    <div className={`card-lodge p-4 ${className}`}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-foreground text-base font-semibold">{title}</h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: PRIMARY_COLOR }}
            />
            <span className="text-foreground font-medium">{primaryYear}</span>
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: COMPARE_COLOR }}
            />
            <span className="text-foreground font-medium">{compareYear}</span>
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={mergedData}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis type="number" className="text-xs" />
          <YAxis
            type="category"
            dataKey="name"
            className="text-xs"
            width={130}
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={(value: string) =>
              value.length > 18 ? `${value.slice(0, 16)}...` : value
            }
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '0.5rem',
            }}
          />
          <Legend />
          <Bar dataKey={String(primaryYear)} fill={PRIMARY_COLOR} radius={[0, 4, 4, 0]}>
            <LabelList
              dataKey={String(primaryYear)}
              position="right"
              className="text-xs"
              fill="hsl(var(--muted-foreground))"
            />
          </Bar>
          <Bar dataKey={String(compareYear)} fill={COMPARE_COLOR} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
