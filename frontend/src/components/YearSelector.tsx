import { Calendar, Loader2, ChevronDown } from 'lucide-react'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react'
import { useCurrentYear } from '../hooks/useCurrentYear'

export default function YearSelector() {
  const { currentYear, setCurrentYear, availableYears, isTransitioning, isYearReady } =
    useCurrentYear()

  // Show loading spinner while waiting for backend year config
  if (!isYearReady || availableYears.length === 0) {
    return (
      <div className="relative">
        <div className="flex items-center gap-2">
          <Calendar className="text-primary h-4 w-4 flex-shrink-0" />
          <div className="flex min-w-[80px] items-center justify-center py-1">
            <Loader2 className="text-primary h-4 w-4 animate-spin" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <Calendar className="text-primary h-4 w-4 flex-shrink-0" />
        <Listbox value={currentYear} onChange={setCurrentYear} disabled={isTransitioning}>
          <div className="relative">
            <ListboxButton className="listbox-button-compact min-w-[80px] disabled:cursor-wait disabled:opacity-50">
              <span>{currentYear}</span>
              <ChevronDown className="text-muted-foreground h-4 w-4" />
            </ListboxButton>
            <ListboxOptions transition className="listbox-options w-auto min-w-[80px]">
              {availableYears.map((year) => (
                <ListboxOption key={year} value={year} className="listbox-option py-1.5">
                  {year}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </div>
        </Listbox>
      </div>

      {isTransitioning && (
        <div className="bg-background/80 absolute inset-0 flex items-center justify-center rounded-xl">
          <Loader2 className="text-primary h-4 w-4 animate-spin" />
        </div>
      )}
    </div>
  )
}
