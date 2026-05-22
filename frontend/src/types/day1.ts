export interface Day1CategoryCounts {
  count: number
}

export interface Day1Category {
  category: 'at_camp' | 'quest' | 'teen'
  label: string
  count: number
}

export interface Day1TierData {
  tier: 'priority' | 'early' | 'open'
  tier_label: string
  date: string
  window_start: string
  window_end: string
  categories: Day1Category[]
  total: Day1CategoryCounts
  approximate: boolean
}

export interface Day1YearData {
  year: number
  tiers: Day1TierData[]
}

export interface Day1Response {
  year: number
  tiers: Day1TierData[]
  prior_years: Day1YearData[]
}
