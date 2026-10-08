import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { useApiWithAuth } from '../../../hooks/useApiWithAuth'
import { fetchAidMarchFile } from '../../../services/camperships/aidApi'
import { buildCsvContent, downloadCsv } from '../../../utils/csvExport'
import { queryKeys } from '../../../utils/queryKeys'
import { MARCH_HEADERS, marchFileName, marchFileResultLine, marchFileRows } from './marchFile'

export interface MarchFile {
  readonly busy: boolean
  /** The result line after a download; null before a click or once dismissed. */
  readonly said: string | null
  readonly error: string | null
  readonly download: () => void
  readonly dismiss: () => void
}

/**
 * The March file's download (spec §8.3; D73; S3-7; P-21; owner ruling E). It reads the rows fresh at the
 * click (`fetchQuery`, staleTime 0), writes the CSV, and changes nothing. A second click while one is in
 * flight is ignored. The page owns this so the menu item and the result line under the toolbar share it.
 */
export function useMarchFile(year: number): MarchFile {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const download = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const file = await queryClient.fetchQuery({
        queryKey: queryKeys.aidMarchFile(year),
        queryFn: () => fetchAidMarchFile(fetchWithAuth, year),
        staleTime: 0,
      })
      downloadCsv(buildCsvContent([...MARCH_HEADERS], marchFileRows(file)), marchFileName(year))
      setSaid(marchFileResultLine(file))
    } catch (caught) {
      setSaid(null)
      setError(caught instanceof Error ? caught.message : "Couldn't make the March file")
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return {
    busy,
    said,
    error,
    download: () => void download(),
    dismiss: () => {
      setSaid(null)
      setError(null)
    },
  }
}
