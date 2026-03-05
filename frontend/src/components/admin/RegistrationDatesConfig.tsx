import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Loader2, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import { pb } from '../../lib/pocketbase'
import { useCurrentYear } from '../../hooks/useCurrentYear'
import { queryKeys, userDataOptions } from '../../utils/queryKeys'
import type { ConfigRecord } from '../../types/pocketbase-types'

interface RegDateConfig {
  id: string | undefined
  key: string
  label: string
  description: string
  value: string
}

const REG_DATE_FIELDS: Array<Omit<RegDateConfig, 'id' | 'value'>> = [
  {
    key: 'priority_reg_date',
    label: 'Priority Registration',
    description: 'When priority/alumni registration opens',
  },
  {
    key: 'early_reg_date',
    label: 'Early Registration',
    description: 'When early registration opens',
  },
  {
    key: 'open_reg_date',
    label: 'Open Registration',
    description: 'When open/general registration opens',
  },
]

function useRegistrationDates(year: number) {
  return useQuery({
    queryKey: queryKeys.registrationDatesConfig(year),
    ...userDataOptions,
    queryFn: async () => {
      const records = await pb.collection('config').getFullList<ConfigRecord>({
        filter: `category = "registration" && subcategory = "${year}"`,
        sort: 'config_key',
      })
      return records
    },
  })
}

export function RegistrationDatesConfig() {
  const { currentYear } = useCurrentYear()
  const queryClient = useQueryClient()
  const { data: configRecords, isLoading } = useRegistrationDates(currentYear)

  const [dates, setDates] = useState<RegDateConfig[]>([])
  const [isSaving, setIsSaving] = useState(false)

  // Sync local state when data loads or year changes
  const buildDatesFromRecords = useCallback((records: ConfigRecord[] | undefined) => {
    return REG_DATE_FIELDS.map((field) => {
      const existing = records?.find((r) => r.config_key === field.key)
      return {
        ...field,
        id: existing?.id,
        value: (existing?.value as string) ?? '',
      }
    })
  }, [])

  useEffect(() => {
    setDates(buildDatesFromRecords(configRecords))
  }, [configRecords, buildDatesFromRecords])

  const handleDateChange = (key: string, value: string) => {
    setDates((prev) => prev.map((d) => (d.key === key ? { ...d, value } : d)))
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      for (const date of dates) {
        if (!date.value) continue

        const payload = {
          category: 'registration',
          subcategory: String(currentYear),
          config_key: date.key,
          value: date.value,
          metadata: {
            business_category: 'registration',
            component_type: 'date',
            friendly_name: date.label,
            source: 'default_config',
          },
          description: date.description,
        }

        if (date.id) {
          await pb.collection('config').update(date.id, payload)
        } else {
          await pb.collection('config').create(payload)
        }
      }

      await queryClient.invalidateQueries({
        queryKey: queryKeys.registrationDatesConfig(currentYear),
      })
      toast.success('Registration dates saved')
    } catch (error) {
      toast.error(`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        <span className="text-muted-foreground ml-2 text-sm">Loading registration dates...</span>
      </div>
    )
  }

  const hasChanges = dates.some((d) => {
    const original = configRecords?.find((r) => r.config_key === d.key)
    const originalValue = (original?.value as string) ?? ''
    return d.value !== originalValue
  })

  return (
    <div className="border-border rounded-xl border p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <CalendarDays className="text-forest-600 dark:text-forest-400 h-5 w-5" />
        <div>
          <h3 className="text-base font-semibold">Registration Dates — {currentYear}</h3>
          <p className="text-muted-foreground text-sm">
            Set when each registration phase opens. Used for velocity analysis.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {dates.map((date) => (
          <div key={date.key} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
            <label htmlFor={date.key} className="text-sm font-medium sm:w-48">
              {date.label}
            </label>
            <input
              id={date.key}
              type="date"
              value={date.value}
              onChange={(e) => handleDateChange(date.key, e.target.value)}
              className="bg-muted/30 dark:bg-muted/50 border-border focus:border-forest-500 focus:ring-forest-500 rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
            />
            <span className="text-muted-foreground text-xs">{date.description}</span>
          </div>
        ))}
      </div>

      {hasChanges && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-forest-600 hover:bg-forest-700 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" /> Save Dates
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
