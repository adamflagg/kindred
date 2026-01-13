import { Calendar, Loader2, ChevronDown } from 'lucide-react';
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react';
import { useCurrentYear } from '../hooks/useCurrentYear';

export default function YearSelector() {
  const { currentYear, setCurrentYear, availableYears, isTransitioning } = useCurrentYear();

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-primary flex-shrink-0" />
        <Listbox
          value={currentYear}
          onChange={setCurrentYear}
          disabled={isTransitioning}
        >
          <div className="relative">
            <ListboxButton className="listbox-button-compact min-w-[80px] disabled:opacity-50 disabled:cursor-wait">
              <span>{currentYear}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </ListboxButton>
            <ListboxOptions className="listbox-options w-auto min-w-[80px]">
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
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-xl">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}
