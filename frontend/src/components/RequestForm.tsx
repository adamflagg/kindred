import { type FormEvent, useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react'
import type { Constraint, Camper, ConstraintType } from '../types/app-types'
import { formatGradeOrdinal } from '../utils/gradeUtils'
import { getDisplayAgeForYear } from '../utils/displayAge'
import { useYear } from '../hooks/useCurrentYear'

interface RequestFormProps {
  campers: Camper[]
  constraint?: Constraint
  onSubmit: (data: Partial<Constraint>) => void
  onCancel: () => void
}

export default function RequestForm({ campers, constraint, onSubmit, onCancel }: RequestFormProps) {
  const viewingYear = useYear()
  // RequestsPanel can mount a "create" RequestForm and an "edit" RequestForm
  // simultaneously (isCreating and editingId are independent state) — unique,
  // instance-scoped ids keep each form's label/control pairing correct rather
  // than colliding on a fixed string.
  const constraintTypeId = useId()
  const agePreferenceId = useId()
  const bunkNameId = useId()
  const [type, setType] = useState<ConstraintType>(constraint?.type ?? 'pair_together')
  // Local mutable working copy; the source `constraint.campers` is readonly.
  const [selectedCampers, setSelectedCampers] = useState<string[]>([...(constraint?.campers ?? [])])
  const [metadata, setMetadata] = useState<Record<string, unknown>>(constraint?.metadata ?? {})

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()

    if (selectedCampers.length === 0) {
      alert('Please select at least one camper')
      return
    }

    if (type === 'pair_together' && selectedCampers.length !== 2) {
      alert('Pair together request requires exactly 2 campers')
      return
    }

    if (type === 'keep_apart' && selectedCampers.length < 2) {
      alert('Keep apart request requires at least 2 campers')
      return
    }

    onSubmit({
      type,
      campers: selectedCampers,
      metadata,
    })
  }

  const toggleCamper = (camperId: string) => {
    setSelectedCampers((prev) =>
      prev.includes(camperId) ? prev.filter((id) => id !== camperId) : [...prev, camperId]
    )
  }

  const getMaxCampers = () => {
    switch (type) {
      case 'pair_together':
        return 2
      case 'age_preference':
      case 'bunk_preference':
        return 1
      default:
        return 10
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Constraint Type */}
      <div>
        <label
          htmlFor={constraintTypeId}
          className="text-foreground mb-1 block text-sm font-medium"
        >
          Constraint Type
        </label>
        <Listbox
          value={type}
          onChange={(v) => {
            setType(v)
            setSelectedCampers([]) // Reset selection on type change
          }}
        >
          <div className="relative">
            <ListboxButton id={constraintTypeId} className="listbox-button">
              <span>
                {type === 'pair_together'
                  ? 'Pair Together'
                  : type === 'keep_apart'
                    ? 'Keep Apart'
                    : type === 'age_preference'
                      ? 'Age Preference'
                      : 'Bunk Preference'}
              </span>
              <ChevronDown className="text-muted-foreground h-4 w-4" />
            </ListboxButton>
            <ListboxOptions transition className="listbox-options w-full">
              <ListboxOption value="pair_together" className="listbox-option">
                Pair Together
              </ListboxOption>
              <ListboxOption value="keep_apart" className="listbox-option">
                Keep Apart
              </ListboxOption>
              <ListboxOption value="age_preference" className="listbox-option">
                Age Preference
              </ListboxOption>
              <ListboxOption value="bunk_preference" className="listbox-option">
                Bunk Preference
              </ListboxOption>
            </ListboxOptions>
          </div>
        </Listbox>
      </div>

      {/* Camper Selection */}
      <div>
        <label className="text-foreground mb-1 block text-sm font-medium">
          Select Campers ({selectedCampers.length}/{getMaxCampers()})
        </label>
        <div className="bg-background max-h-48 overflow-y-auto rounded-md border p-2">
          {campers.map((camper) => (
            <label
              key={camper.id}
              className="hover:bg-muted/50 flex cursor-pointer items-center p-2 transition-colors duration-75"
            >
              <input
                type="checkbox"
                checked={selectedCampers.includes(camper.id)}
                onChange={() => toggleCamper(camper.id)}
                disabled={
                  !selectedCampers.includes(camper.id) && selectedCampers.length >= getMaxCampers()
                }
                className="mr-3 h-5 w-5 cursor-pointer sm:h-4 sm:w-4"
              />
              {/* Direct children, not wrapped in an intermediate div — jsx-a11y/
                  label-has-associated-control only walks 2 levels deep by default,
                  and the label's accessible text (inside these spans) needs to
                  stay within that budget. */}
              <span className="font-medium">{camper.name}</span>
              <span className="text-muted-foreground ml-2 text-sm">
                Age {(getDisplayAgeForYear(camper, viewingYear) ?? 0).toFixed(2)} •{' '}
                {formatGradeOrdinal(camper.grade)}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Type-specific fields */}
      {type === 'age_preference' && (
        <div>
          <label
            htmlFor={agePreferenceId}
            className="text-foreground mb-1 block text-sm font-medium"
          >
            Age Preference
          </label>
          <Listbox
            value={(metadata['preference'] as string) || 'similar'}
            onChange={(v) => setMetadata({ ...metadata, preference: v })}
          >
            <div className="relative">
              <ListboxButton id={agePreferenceId} className="listbox-button">
                <span>
                  {(metadata['preference'] as string) === 'older'
                    ? 'Older Campers'
                    : (metadata['preference'] as string) === 'younger'
                      ? 'Younger Campers'
                      : 'Similar Age'}
                </span>
                <ChevronDown className="text-muted-foreground h-4 w-4" />
              </ListboxButton>
              <ListboxOptions transition className="listbox-options w-full">
                <ListboxOption value="similar" className="listbox-option">
                  Similar Age
                </ListboxOption>
                <ListboxOption value="older" className="listbox-option">
                  Older Campers
                </ListboxOption>
                <ListboxOption value="younger" className="listbox-option">
                  Younger Campers
                </ListboxOption>
              </ListboxOptions>
            </div>
          </Listbox>
        </div>
      )}

      {type === 'bunk_preference' && (
        <div>
          <label htmlFor={bunkNameId} className="text-foreground mb-1 block text-sm font-medium">
            Preferred Bunk Name (optional)
          </label>
          <input
            id={bunkNameId}
            type="text"
            value={(metadata['bunkName'] as string) || ''}
            onChange={(e) => setMetadata({ ...metadata, bunkName: e.target.value })}
            placeholder="e.g., B-10 or Teen 1"
            className="bg-background text-foreground focus:ring-primary w-full rounded-md border px-3 py-2 focus:ring-2 focus:outline-none"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end space-x-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="hover:bg-muted/50 rounded-md border px-4 py-2 transition-colors duration-75"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 transition-colors duration-75"
        >
          {constraint ? 'Update' : 'Create'} Constraint
        </button>
      </div>
    </form>
  )
}
