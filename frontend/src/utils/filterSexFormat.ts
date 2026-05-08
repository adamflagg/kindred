export type FilterSex = 'all' | 'M' | 'F'

const LABELS: Record<FilterSex, string> = {
  all: 'All',
  M: 'Boys',
  F: 'Girls',
}

const CSV_SEGMENTS: Record<FilterSex, string> = {
  all: '',
  M: '-boys',
  F: '-girls',
}

export function filterSexLabel(filterSex: FilterSex): string {
  return LABELS[filterSex]
}

export function filterSexCsvSegment(filterSex: FilterSex): string {
  return CSV_SEGMENTS[filterSex]
}
