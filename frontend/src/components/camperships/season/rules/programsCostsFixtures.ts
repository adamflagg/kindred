import type { ApiAidGroup } from '../../../../types/api-types'
import type { CatalogSession } from '../../../../hooks/camperships/useAidSessionCatalog'
import type { ProgramsCostsDoc } from './programsCostsModel'

const s = (
  cmId: number,
  name: string,
  startDate: string,
  type: string,
  sortOrder = 0,
  parentId = 0,
  endDate = ''
): CatalogSession => ({ cmId, name, startDate, endDate, sortOrder, type, parentId })

export const CATALOG: readonly CatalogSession[] = [
  s(1000101, 'Session 2', '2027-06-20', 'main', 2),
  s(1000104, 'Starter Session', '2027-06-13', 'main', 1),
  s(1000103, 'AG Session 2', '2027-06-20', 'ag', 3, 1000101),
  s(1000102, 'Session 2b', '2027-06-20', 'embedded', 4),
  s(1000106, 'Quest: Rivers', '2027-07-05', 'quest'),
  s(1000110, 'Winter Retreat', '2027-01-10', 'teen'),
  s(1000107, 'Leader in Training', '2027-06-20', 'scit', 5),
  s(1000201, 'Family Camp A', '2027-05-28', 'family'),
  s(1000202, 'Family Camp B', '2027-08-20', 'family'),
  s(1000401, 'Adult Weekend', '2027-09-10', 'adult'),
  s(1000501, 'Coming-of-Age Year 1', '2027-01-10', 'bmitzvah'),
  s(1000901, 'Staff Week', '2027-06-01', 'other'),
  s(1000902, 'New Session Nobody Placed', '2027-07-01', 'hebrew'),
]

export const GROUPS: readonly ApiAidGroup[] = [
  { pool: 'camp_pool', label: 'Camp', equity_class: 'summer' },
  { pool: 'weekend_pool', label: 'Weekends', equity_class: 'family' },
  { pool: 'school_pool', label: 'School', equity_class: 'school' },
]

export function pcDoc(): ProgramsCostsDoc {
  return {
    pools: {
      camp_pool: { label: 'Camp' },
      weekend_pool: { label: 'Weekends' },
      school_pool: { label: 'School' },
    },
    programs: {
      summer: {
        label: 'Summer',
        session_cm_ids: [1000101, 1000102, 1000103, 1000104, 1000106, 1000107],
        budget_pool: 'camp_pool',
        cost_source: 'catalog',
        equity_class: 'summer',
        table_from_equity_class: true,
      },
      teen: {
        label: 'Teen Programs',
        session_cm_ids: [1000110],
        budget_pool: 'camp_pool',
        cost_source: 'catalog',
        equity_class: 'summer',
        table_from_equity_class: true,
      },
      family_camp: {
        label: 'Family Camp',
        session_cm_ids: [1000201, 1000202],
        budget_pool: 'weekend_pool',
        cost_source: 'per_person',
        equity_class: 'family',
        table_from_equity_class: true,
      },
      adult_weekend: {
        label: 'Adult Weekend',
        session_cm_ids: [1000401],
        budget_pool: 'weekend_pool',
        cost_source: 'catalog',
        equity_class: 'family',
        table_from_equity_class: false,
        r1_table: null,
      },
      school: {
        label: 'School',
        session_cm_ids: [1000501],
        budget_pool: 'school_pool',
        cost_source: 'catalog',
        equity_class: 'school',
        table_from_equity_class: true,
      },
      not_aided: {
        label: 'Not open to aid',
        session_cm_ids: [1000901],
        budget_pool: null,
        cost_source: 'catalog',
        open_to_aid: false,
        equity_class: null,
      },
    },
    cost: {
      tuition: {
        '1000101': '6695.0',
        '1000102': '4995',
        '1000103': '6695',
        '1000104': '1795',
        '1000106': '6695',
        '1000501': '3950',
      },
      family_rates: [{ session_cm_id: 1000201, standard: '425', infant: '0' }],
      not_running_session_cm_ids: [1000106],
      infant_age_cutoff_months: null,
    },
  }
}
