import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const CHART_FILES = [
  { name: 'TrendLineChart', path: './TrendLineChart.tsx' },
  { name: 'RetentionRateLine', path: './RetentionRateLine.tsx' },
  { name: 'RetentionRateLineChart', path: './RetentionRateLineChart.tsx' },
]

describe('ChartCard-wrapped charts use numeric ResponsiveContainer height', () => {
  for (const { name, path } of CHART_FILES) {
    it(`${name} passes numeric barsHeight to ResponsiveContainer`, () => {
      const source = readFileSync(resolve(__dirname, path), 'utf-8')
      expect(source).toContain('height={barsHeight}')
      expect(source).not.toMatch(/ResponsiveContainer[^>]*height="100%"/)
    })
  }
})
