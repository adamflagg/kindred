/**
 * Reports › Programs fixtures (slice 4): an invented 2027 season in the shape of `ProgramsResponse`.
 * Pools and sessions carry invented labels ("Pool A", "Session 2"); every figure is invented, and
 * each subtotal and total is what the server would send (pooled ratios, never averages of rows).
 */
import type { ApiAidProgramRow, ApiAidPrograms, ApiAidRoundBlock } from '../../../types/api-types'

const block = (over: Partial<ApiAidRoundBlock> = {}): ApiAidRoundBlock => ({
  apps: 0,
  requested: 0,
  // raw and uncapped: equal to Requested unless a block says otherwise
  requested_as_typed: over.requested ?? 0,
  asks: 0,
  awarded: 0,
  awarded_count: 0,
  average_request: null,
  average_award: null,
  pct_awarded: null,
  ...over,
})

const row = (over: Partial<ApiAidProgramRow>): ApiAidProgramRow => ({
  session_cm_id: 0,
  session_name: '',
  round1: block(),
  round2: block(),
  round3: block(),
  total_awarded: 0,
  ...over,
})

export const SESSION_2 = row({
  session_cm_id: 1000102,
  session_name: 'Session 2',
  session_type: 'main',
  round1: block({
    apps: 2,
    requested: 6000,
    asks: 2,
    awarded: 1500,
    awarded_count: 1,
    average_request: 3000,
    average_award: 1500,
    pct_awarded: 25,
  }),
  round2: block({
    apps: 1,
    requested: 900,
    asks: 1,
    awarded: 600,
    awarded_count: 1,
    average_request: 900,
    average_award: 600,
    pct_awarded: 66.7,
  }),
  total_awarded: 2100,
})

export const PROGRAMS: ApiAidPrograms = {
  year: 2027,
  as_of: null,
  as_of_axis: null,
  figures_on: '2027-04-10',
  rules_version: 3,
  pools: [
    {
      pool: 'pool_a',
      pool_label: 'Pool A',
      sessions: [
        SESSION_2,
        row({
          session_cm_id: 1000103,
          session_name: 'Session 3',
          session_type: 'main',
          round1: block({
            apps: 1,
            requested: 2000,
            asks: 1,
            average_request: 2000,
            pct_awarded: 0,
          }),
        }),
      ],
      subtotal: row({
        session_name: 'Pool A',
        round1: block({
          apps: 3,
          requested: 8000,
          asks: 3,
          awarded: 1500,
          awarded_count: 1,
          average_request: 2666.67,
          average_award: 1500,
          pct_awarded: 18.8,
        }),
        round2: block({
          apps: 1,
          requested: 900,
          asks: 1,
          awarded: 600,
          awarded_count: 1,
          average_request: 900,
          average_award: 600,
          pct_awarded: 66.7,
        }),
        total_awarded: 2100,
      }),
    },
  ],
  total: row({
    session_name: 'All pools',
    round1: block({
      apps: 3,
      requested: 8000,
      requested_as_typed: 9500,
      asks: 3,
      awarded: 1500,
      awarded_count: 1,
      average_request: 2666.67,
      average_award: 1500,
      pct_awarded: 18.8,
    }),
    round2: block({
      apps: 1,
      requested: 900,
      asks: 1,
      awarded: 600,
      awarded_count: 1,
      average_request: 900,
      average_award: 600,
      pct_awarded: 66.7,
    }),
    total_awarded: 2100,
  }),
  request_set: null,
  not_rebuilt: [],
}

/** Two pools, the second a Family Camp one: the Award table filter and the household mark. */
const POOL_B = {
  pool: 'pool_b',
  pool_label: 'Pool B',
  sessions: [
    row({
      session_cm_id: 1000201,
      session_name: 'Family Camp 3: Young Families Weekend',
      session_type: 'family',
      round1: block({
        apps: 2,
        requested: 3000,
        asks: 2,
        awarded: 900,
        awarded_count: 1,
        average_request: 1500,
        average_award: 900,
        pct_awarded: 30,
      }),
      total_awarded: 900,
    }),
  ],
  subtotal: row({
    session_name: 'Pool B',
    round1: block({
      apps: 2,
      requested: 3000,
      asks: 2,
      awarded: 900,
      awarded_count: 1,
      average_request: 1500,
      average_award: 900,
      pct_awarded: 30,
    }),
    total_awarded: 900,
  }),
}

export const PROGRAMS_TWO_POOLS: ApiAidPrograms = {
  ...PROGRAMS,
  pools: [...PROGRAMS.pools, POOL_B],
}
