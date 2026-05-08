import { describe, it, expect } from 'vitest'
import { filterSexLabel, filterSexCsvSegment } from './filterSexFormat'

describe('filterSexLabel', () => {
  it('all → All', () => {
    expect(filterSexLabel('all')).toBe('All')
  })

  it('M → Boys', () => {
    expect(filterSexLabel('M')).toBe('Boys')
  })

  it('F → Girls', () => {
    expect(filterSexLabel('F')).toBe('Girls')
  })
})

describe('filterSexCsvSegment', () => {
  it('M → -boys', () => {
    expect(filterSexCsvSegment('M')).toBe('-boys')
  })

  it('F → -girls', () => {
    expect(filterSexCsvSegment('F')).toBe('-girls')
  })

  it('all → empty string', () => {
    expect(filterSexCsvSegment('all')).toBe('')
  })
})
