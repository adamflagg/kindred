/**
 * Collapsible panel showing original CSV import data
 * Shows raw bunking data before AI parsing
 */
import { useState } from 'react'
import { GraduationCap, ChevronDown, ChevronRight, User } from 'lucide-react'
import type { OriginalBunkData } from '../../hooks/camper/types'
import { formatSyncDates } from '../../utils/rawDataDates'

interface RawDataPanelProps {
  data: OriginalBunkData
  year: number
  defaultExpanded?: boolean
}

interface StaffAttribution {
  content: string
  staffName: string | null
  timestamp: string | null
}

/**
 * Parse staff attribution from bunking_notes text
 * Pattern: "Note text STAFFNAME (Month DD YYYY H:MMAM/PM)"
 * Example: "Do not bunk with Emma JORDAN RIVERS (May 30 2024 2:18PM)"
 */
function parseStaffAttribution(text: string | undefined): StaffAttribution | null {
  if (!text) return null

  // Pattern matches: FIRSTNAME LASTNAME (Month DD YYYY H:MMAM/PM)
  const staffPattern =
    /([A-Z]+)\s+([A-Z]+)\s*\(([A-Za-z]+\s+\d{1,2}\s+\d{4}\s+\d{1,2}:\d{2}(?:AM|PM))\)\s*$/

  // Split by newlines for multi-entry notes
  const lines = text.split('\n').filter((l) => l.trim())
  const parsedLines: Array<{
    content: string
    staff: string | null
    timestamp: string | null
  }> = []

  for (const line of lines) {
    const match = staffPattern.exec(line)
    if (match?.[1] && match[2] && match[3]) {
      const content = line.slice(0, match.index).trim()
      const firstName = match[1].charAt(0) + match[1].slice(1).toLowerCase()
      const lastName = match[2].charAt(0) + match[2].slice(1).toLowerCase()
      parsedLines.push({
        content,
        staff: `${firstName} ${lastName}`,
        timestamp: match[3],
      })
    } else {
      parsedLines.push({ content: line, staff: null, timestamp: null })
    }
  }

  // Join all content, use most recent staff attribution
  const allContent = parsedLines.map((p) => p.content).join(' | ')
  const staffEntries = parsedLines.filter((p) => p.staff)
  const mostRecent = staffEntries.at(-1)

  return {
    content: allContent || text,
    staffName: mostRecent?.staff ?? null,
    timestamp: mostRecent?.timestamp ?? null,
  }
}

function RawDataField({
  label,
  value,
  updatedAt,
  processedAt,
  staffParsing = false,
}: {
  label: string
  value: string | undefined
  updatedAt: string | undefined
  processedAt: string | undefined
  staffParsing?: boolean
}) {
  const parsed = staffParsing ? parseStaffAttribution(value) : null
  const displayContent = parsed?.content ?? value
  const dates = formatSyncDates(updatedAt, processedAt)

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <dt className="text-muted-foreground text-sm font-medium">{label}</dt>
        <div className="text-muted-foreground flex items-center gap-3 text-xs">
          {dates.mode === 'same-day' && (
            <span className="text-green-600 dark:text-green-400">
              Synced & Processed: {dates.syncedDisplay}
            </span>
          )}
          {dates.mode === 'different-days' && (
            <>
              <span>Synced: {dates.syncedDisplay}</span>
              <span className="text-green-600 dark:text-green-400">
                Processed: {dates.processedDisplay}
              </span>
            </>
          )}
          {dates.mode === 'synced-only' && (
            <>
              <span>Synced: {dates.syncedDisplay}</span>
              {displayContent && (
                <span className="text-amber-600 italic dark:text-amber-400">Not yet processed</span>
              )}
            </>
          )}
        </div>
      </div>
      <dd className="bg-muted/50 mt-1 rounded-lg p-3 text-sm whitespace-pre-wrap">
        {displayContent ? (
          <>
            {displayContent}
            {/* Staff attribution badge */}
            {parsed?.staffName && (
              <div className="border-border/30 text-muted-foreground mt-2 flex items-center gap-2 border-t pt-2 text-xs">
                <User className="h-3 w-3 flex-shrink-0" />
                <span className="font-medium">{parsed.staffName}</span>
                {parsed.timestamp && (
                  <>
                    <span className="opacity-40">•</span>
                    <span className="opacity-75">{parsed.timestamp}</span>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <span className="text-muted-foreground italic">No data</span>
        )}
      </dd>
    </div>
  )
}

export function RawDataPanel({ data, year, defaultExpanded = false }: RawDataPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-sm">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="bg-bark-50 dark:bg-bark-900/60 hover:bg-bark-100 dark:hover:bg-bark-900/80 flex w-full items-center justify-between px-6 py-4 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="bg-bark-100 dark:bg-bark-800 rounded-lg p-2">
            <GraduationCap className="text-bark-600 dark:text-bark-300 h-5 w-5" />
          </div>
          <div className="text-left">
            <h2 className="font-display text-foreground text-lg font-bold">Raw Bunking Data</h2>
            <p className="text-muted-foreground text-xs">Original CSV Import - {year}</p>
          </div>
        </div>
        {isExpanded ? (
          <ChevronDown className="text-muted-foreground h-5 w-5" />
        ) : (
          <ChevronRight className="text-muted-foreground h-5 w-5" />
        )}
      </button>

      {isExpanded && (
        <div className="space-y-4 p-6">
          <RawDataField
            label="Bunk Request Form"
            value={data.share_bunk_with}
            updatedAt={data.share_bunk_with_updated}
            processedAt={data.share_bunk_with_processed}
          />

          <RawDataField
            label="Do NOT Share Bunk With"
            value={data.do_not_share_bunk_with}
            updatedAt={data.do_not_share_bunk_with_updated}
            processedAt={data.do_not_share_bunk_with_processed}
          />

          <RawDataField
            label="Internal Notes"
            value={data.internal_bunk_notes}
            updatedAt={data.internal_bunk_notes_updated}
            processedAt={data.internal_bunk_notes_processed}
          />

          <RawDataField
            label="Bunking Notes"
            value={data.bunking_notes_notes}
            updatedAt={data.bunking_notes_notes_updated}
            processedAt={data.bunking_notes_notes_processed}
            staffParsing={true}
          />

          <RawDataField
            label="Social With Checkbox"
            value={data.ret_parent_socialize_with_best}
            updatedAt={data.ret_parent_socialize_with_best_updated}
            processedAt={data.ret_parent_socialize_with_best_processed}
          />

          {/* Person Metadata */}
          <div className="border-border mt-4 border-t pt-4">
            <p className="text-muted-foreground text-xs">
              {data.first_name} {data.last_name} • Person ID: {data.person_cm_id}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default RawDataPanel
