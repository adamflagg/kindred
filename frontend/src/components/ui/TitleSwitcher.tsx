/**
 * The page title that is also the switcher.
 *
 * Summer's session header and the weekend roster header both make the
 * program's name the page title AND the control that changes it. That markup
 * was duplicated verbatim between the two — a 100-character class string
 * included — which is exactly how the two surfaces drift apart on styling.
 * This holds the one copy.
 *
 * Deliberately unopinionated about WHAT is being switched: it takes flat
 * value/label pairs rather than sessions, because the two callers key on
 * different things (a CampMinder session id, a weekend slug).
 */
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { ChevronDown, type LucideIcon } from 'lucide-react'

export interface TitleSwitcherOption {
  /** What `onChange` reports — a session cm_id, a weekend slug. */
  value: string
  label: string
}

export interface TitleSwitcherProps {
  /** Program mark beside the title — a tent for summer, a cabin for weekends. */
  icon: LucideIcon
  /**
   * Button text. NOT derived from the selected option: the weekend header
   * reads "Loading weekends…" and "Weekend not found" in the gaps where
   * nothing is resolved yet, and neither is an option you can pick.
   */
  label: string
  value: string
  options: TitleSwitcherOption[]
  onChange: (value: string) => void
  /**
   * Extra classes for the dropdown, chiefly its min-width — a weekend name
   * runs longer than a session name. Pass a LITERAL string: Tailwind scans
   * source text, so a value built at runtime compiles to nothing.
   */
  optionsClassName?: string
}

export function TitleSwitcher({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  optionsClassName = 'min-w-[160px]',
}: TitleSwitcherProps) {
  return (
    <div className="flex flex-shrink-0 items-center gap-2">
      <Icon className="text-primary h-5 w-5 flex-shrink-0 sm:h-6 sm:w-6" />
      <Listbox value={value} onChange={onChange}>
        <div className="relative">
          <ListboxButton className="font-display hover:text-primary flex cursor-pointer items-center gap-1 bg-transparent text-xl font-bold transition-colors focus:outline-none sm:text-2xl">
            {label}
            <ChevronDown className="text-muted-foreground h-4 w-4" />
          </ListboxButton>
          <ListboxOptions transition className={`listbox-options w-auto ${optionsClassName}`}>
            {options.map((option) => (
              <ListboxOption
                key={option.value}
                value={option.value}
                className="listbox-option py-1.5"
              >
                {option.label}
              </ListboxOption>
            ))}
          </ListboxOptions>
        </div>
      </Listbox>
    </div>
  )
}
