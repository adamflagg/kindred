import { useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useRef, useState } from 'react'

import { useApiWithAuth } from '../../../hooks/useApiWithAuth'
import { fetchAidMarchFile } from '../../../services/camperships/aidApi'
import { buildCsvContent, downloadCsv } from '../../../utils/csvExport'
import { queryKeys } from '../../../utils/queryKeys'
import { BUTTON_SECONDARY } from '../../admin/lodging/lodgingStyles'
import { CS_AMBER_NOTE, CS_SMALL } from '../kit/csType'
import {
  MARCH_FILE_NOTE,
  MARCH_HEADERS,
  marchFileName,
  marchFileRows,
  marchFileWords,
  zeroLeftOutWords,
} from './marchFile'

/** The line under the toolbar: its own row of the toolbar's wrap, at the right under the two buttons. */
const UNDER = 'basis-full text-right'

/**
 * "Download the March File" (spec §8.3; D73; S3-7; P-21; owner ruling E), beside Download CSV on
 * Requests › Needs an offer with the Round 1 chip lit, for casework on a live read (the page decides).
 * It reads the rows fresh at the click (`fetchQuery`, staleTime 0) and writes the CSV; it changes
 * nothing. After a download it says how many rows and requests the file holds, and how many Round 1
 * offers of $0 it left out (they stay in Needs an offer, for a letter and Mark Posted by hand).
 * Drawn inside AidTable's toolbar (`toolbarTrail`): the button beside Download CSV, its words on a line
 * of their own under it.
 */
export function MarchFileButton({ year }: { year: number }) {
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
      const zero = zeroLeftOutWords(file)
      setSaid(`Downloaded: ${marchFileWords(file)}.${zero === null ? '' : ` ${zero}`}`)
    } catch (caught) {
      setSaid(null)
      setError(caught instanceof Error ? caught.message : "Couldn't make the March file")
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={BUTTON_SECONDARY}
        disabled={busy}
        onClick={() => void download()}
      >
        <Download className="h-4 w-4" />
        {busy ? 'Making the File…' : 'Download the March File'}
      </button>
      <p className={`${UNDER} ${CS_SMALL}`}>{MARCH_FILE_NOTE}</p>
      {said !== null && <p className={`${UNDER} text-xs`}>{said}</p>}
      {error !== null && <p className={`${UNDER} ${CS_AMBER_NOTE}`}>{error}</p>}
    </>
  )
}
