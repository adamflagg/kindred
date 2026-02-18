/**
 * MultiYearBreakdownChart - Generic grouped bar chart for multi-year enrollment breakdowns.
 *
 * Renders a Recharts grouped BarChart from YearEnrollment data, extracting the
 * specified breakdown key and showing one bar per year for each category.
 * Categories are sorted by total count (desc) and limited to topN.
 *
 * Pattern: Follows GradeEnrollmentChart.tsx
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
} from 'recharts'
import type { YearEnrollment } from '../../types/metrics'

// Year-specific colors matching GradeEnrollmentChart
const YEAR_COLORS = [
  'hsl(200, 70%, 50%)', // Blue (oldest)
  'hsl(160, 100%, 35%)', // Green (middle)
  'hsl(42, 92%, 50%)', // Gold (most recent)
  'hsl(280, 60%, 50%)', // Purple
  'hsl(350, 70%, 50%)', // Red
]

type BreakdownKey =
  | 'by_summer_years'
  | 'by_first_summer_year'
  | 'by_city'
  | 'by_school'
  | 'by_synagogue'

interface MultiYearBreakdownChartProps {
  data: YearEnrollment[]
  breakdownKey: BreakdownKey
  /** Field name within the breakdown item to use as label (e.g., 'city', 'school') */
  labelKey: string
  title?: string
  /** Limit to top N categories by total across years */
  topN?: number
  /** Custom formatter for category labels */
  nameFormatter?: (key: string | number) => string
  height?: number
  className?: string
}

interface ChartDataItem {
  name: string
  [key: string]: string | number | null
}

/**
 * Extract and transform breakdown data into chart format.
 */
function transformData(
  data: YearEnrollment[],
  breakdownKey: BreakdownKey,
  labelKey: string,
  topN: number,
  nameFormatter?: (key: string | number) => string
): { chartData: ChartDataItem[]; years: number[] } {
  const years = data.map((y) => y.year).sort((a, b) => a - b)

  // Collect all categories and their totals
  const categoryTotals = new Map<string, number>()

  for (const yearData of data) {
    const breakdown = yearData[breakdownKey] as Array<Record<string, unknown>> | undefined
    if (!breakdown) continue

    for (const item of breakdown) {
      const rawKey = item[labelKey]
      const key = rawKey != null ? String(rawKey) : ''
      if (!key) continue
      const count = (item['count'] as number) ?? 0
      categoryTotals.set(key, (categoryTotals.get(key) ?? 0) + count)
    }
  }

  // Sort by total desc, take topN
  const topCategories = Array.from(categoryTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([key]) => key)

  // Build chart data
  const chartData: ChartDataItem[] = topCategories.map((key) => {
    const displayName = nameFormatter ? nameFormatter(key) : key
    const item: ChartDataItem = { name: displayName }

    for (const yearData of data) {
      const breakdown = yearData[breakdownKey] as Array<Record<string, unknown>> | undefined
      if (!breakdown) {
        item[yearData.year.toString()] = 0
        continue
      }
      const match = breakdown.find((b) => String(b[labelKey]) === key)
      item[yearData.year.toString()] = (match?.['count'] as number) ?? 0
    }

    return item
  })

  return { chartData, years }
}

export function MultiYearBreakdownChart({
  data,
  breakdownKey,
  labelKey,
  title = 'Multi-Year Comparison',
  topN = 15,
  nameFormatter,
  height = 300,
  className = '',
}: MultiYearBreakdownChartProps) {
  const hasData = data.some((y) => {
    const breakdown = y[breakdownKey] as Array<unknown> | undefined
    return breakdown && breakdown.length > 0
  })

  if (data.length === 0 || !hasData) {
    return (
      <div className={`card-lodge p-4 ${className}`}>
        <h3 className="text-foreground mb-4 text-sm font-semibold">{title}</h3>
        <div className="text-muted-foreground flex h-[200px] items-center justify-center">
          No data available
        </div>
      </div>
    )
  }

  const { chartData, years } = transformData(data, breakdownKey, labelKey, topN, nameFormatter)

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean
    payload?: Array<{ name: string; value: number; color: string }>
    label?: string
  }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card border-border rounded-lg border p-3 shadow-lg">
          <p className="text-foreground mb-2 font-medium">{label}</p>
          {payload.map((p, idx) => (
            <p key={idx} className="text-muted-foreground text-sm">
              <span style={{ color: p.color }}>Year {p.name}:</span>{' '}
              <span className="text-foreground font-semibold">{p.value}</span>
            </p>
          ))}
        </div>
      )
    }
    return null
  }

  return (
    <div className={`card-lodge p-4 ${className}`}>
      <h3 className="text-foreground mb-4 text-sm font-semibold">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="name"
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            angle={chartData.length > 8 ? -45 : 0}
            textAnchor={chartData.length > 8 ? 'end' : 'middle'}
            height={chartData.length > 8 ? 80 : 30}
          />
          <YAxis className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {years.map((year, index) => (
            <Bar
              key={year}
              dataKey={year.toString()}
              name={year.toString()}
              fill={YEAR_COLORS[index % YEAR_COLORS.length] ?? 'hsl(0, 0%, 50%)'}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
