import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { useAidLinkCandidates } from '../../../hooks/camperships/useAidFormResponses'
import { useApiWithAuth } from '../../../hooks/useApiWithAuth'
import { fetchAidLinkCandidates } from '../../../services/camperships/aidApi'
import { queryKeys } from '../../../utils/queryKeys'
import { CS_AMBER_NOTE, CS_POPEN_META } from '../kit/csType'
import type { SessionIndex } from './intakeModel'
import type { FormResponseOut, LinkCandidateOut } from './intakeTypes'
import { LinkResponseEditor } from './LinkResponseEditor'

/**
 * Link… opened on a response (adult aid form design §5; mock v2 steps 7–10, 19): its own read first, the only one that
 * carries the respondent email and each candidate's birthdate and email, then the editor. "Someone else" searches the
 * season's registrations through the same read, cached under the intake prefix like every Form intake read.
 */
export function LinkResponsePanel({
  response,
  year,
  names,
  onLink,
  onCancel,
}: {
  response: FormResponseOut
  year: number
  names: SessionIndex
  onLink: (personCmId: number) => Promise<unknown>
  onCancel: () => void
}) {
  const read = useAidLinkCandidates(response.id)
  const queryClient = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()
  const search = useCallback(
    async (q: string): Promise<readonly LinkCandidateOut[]> => {
      const found = await queryClient.fetchQuery({
        queryKey: queryKeys.aidIntakeLinkCandidates(year, response.id, q),
        queryFn: () => fetchAidLinkCandidates(fetchWithAuth, year, response.id, q),
      })
      return found.candidates ?? []
    },
    [queryClient, fetchWithAuth, year, response.id]
  )
  if (read.isLoading) return <p className={`${CS_POPEN_META} mt-2`}>Reading who it matches…</p>
  if (read.data === undefined)
    return (
      <p className={`${CS_AMBER_NOTE} mt-2`}>
        {read.error instanceof Error
          ? read.error.message
          : "Couldn't read who the response matches"}
      </p>
    )
  return (
    <LinkResponseEditor
      response={response}
      link={read.data}
      names={names}
      onLink={onLink}
      onCancel={onCancel}
      search={search}
    />
  )
}
