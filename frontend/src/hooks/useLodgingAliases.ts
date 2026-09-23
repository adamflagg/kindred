/**
 * The cabin-name alias list, shared by the aliases panel (its table, and the
 * editor's duplicate check) and the unresolved-name queue (which checks a
 * row's name against it before mapping). Year-free by design: an alias
 * carries its own year window.
 */
import { useQuery } from '@tanstack/react-query'

import { listLodgingAliases } from '../services/lodgingCrud'
import { queryKeys, userDataOptions } from '../utils/queryKeys'

export function useLodgingAliases() {
  return useQuery({
    queryKey: queryKeys.lodgingAliases(),
    ...userDataOptions,
    queryFn: listLodgingAliases,
  })
}
