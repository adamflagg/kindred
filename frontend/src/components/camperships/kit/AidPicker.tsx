import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { ChevronDown } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'

import { multiPickerWords, namesOf, type AidPickerOption } from './pickerWords'
import {
  CS_PICKER,
  CS_PICKER_FIELD,
  CS_PICKER_GROUP,
  CS_PICKER_OPTION,
  CS_PICKER_OPTIONS,
} from './csType'

interface PickerBase<V extends string | number> {
  /** The control's name ("Program"): the button reads "Program: All" to a test or a screen reader. */
  readonly label: string
  readonly options: ReadonlyArray<AidPickerOption<V>>
  /** `field` is the editor's 30px, 13.5px face; the default is the toolbar's 26px, 12.5px one. */
  readonly size?: 'control' | 'field'
  readonly disabled?: boolean
  readonly className?: string
}

const CHECK = 'text-primary absolute left-[7px]'
const BOX =
  'border-border bg-card text-primary-foreground absolute left-1.5 inline-flex h-3 w-3 items-center justify-center rounded-[3px] border text-[9px] leading-none'
const BOX_ON = 'bg-primary border-primary'

function faceOf(size: PickerBase<string>['size']): string {
  return size === 'field' ? CS_PICKER_FIELD : CS_PICKER
}

/** The options, with a heading wherever the group changes. */
function OptionList<V extends string | number>({
  options,
  render,
}: {
  options: ReadonlyArray<AidPickerOption<V>>
  render: (option: AidPickerOption<V>) => ReactNode
}) {
  return options.map((option, index) => {
    const heading = option.group !== undefined && option.group !== options[index - 1]?.group
    return (
      <Fragment key={String(option.value)}>
        {heading && (
          <div className={CS_PICKER_GROUP} role="presentation">
            {option.group}
          </div>
        )}
        {render(option)}
      </Fragment>
    )
  })
}

function Face({
  shown,
  title,
  label,
  className,
}: {
  shown: string
  title: string
  label: string
  className: string
}) {
  return (
    <ListboxButton className={className} title={title} aria-label={`${label}: ${shown}`}>
      <span className="min-w-0 truncate">{shown}</span>
      <ChevronDown className="text-muted-foreground h-3.5 w-3.5 flex-none" aria-hidden />
    </ListboxButton>
  )
}

/**
 * The white stylized picker (design-language §3; kit CF.picker): every select in Camperships. A
 * Headless UI Listbox in the kit's dress, with the picked label as its title so a cut label reads
 * whole, group headings, and a ✓ on the picked option.
 */
export function AidPicker<V extends string | number>({
  label,
  value,
  options,
  onChange,
  size,
  disabled,
  className,
}: PickerBase<V> & { readonly value: V; readonly onChange: (value: V) => void }) {
  const shown = options.find((o) => o.value === value)?.label ?? String(value)
  return (
    <Listbox value={value} onChange={onChange} disabled={disabled ?? false}>
      <div className={`relative inline-flex ${className ?? ''}`}>
        <Face shown={shown} title={shown} label={label} className={faceOf(size)} />
        <ListboxOptions transition className={CS_PICKER_OPTIONS}>
          <OptionList
            options={options}
            render={(option) => (
              <ListboxOption
                value={option.value}
                disabled={option.disabled ?? false}
                className={
                  option.level === 'heading' ? `${CS_PICKER_OPTION} font-bold` : CS_PICKER_OPTION
                }
                style={option.level === 'indent' ? { paddingLeft: 34 } : undefined}
              >
                {({ selected }) => (
                  <>
                    {selected && (
                      <span className={CHECK} aria-hidden>
                        ✓
                      </span>
                    )}
                    {option.label}
                  </>
                )}
              </ListboxOption>
            )}
          />
        </ListboxOptions>
      </div>
    </Listbox>
  )
}

/**
 * The same white picker, multi-choice (rev1 2026-10-09: "the funds reporting group picker needs to
 * support multi select"): a checkbox per option, the popover staying open while staff check
 * several, and every picked name in the button's title.
 */
export function AidPickerMulti<V extends string | number>({
  label,
  values,
  options,
  noun,
  none,
  onChange,
  size,
  disabled,
  className,
}: PickerBase<V> & {
  readonly values: readonly V[]
  /** The plural for the count ("groups"). */
  readonly noun: string
  /** What nothing picked reads ("Needs a group"). */
  readonly none: string
  readonly onChange: (values: V[]) => void
}) {
  const shown = multiPickerWords(values, options, noun, none)
  const title = values.length === 0 ? none : namesOf(values, options)
  return (
    <Listbox value={[...values]} onChange={onChange} disabled={disabled ?? false} multiple>
      <div className={`relative inline-flex ${className ?? ''}`}>
        <Face shown={shown} title={title} label={label} className={faceOf(size)} />
        <ListboxOptions transition className={CS_PICKER_OPTIONS}>
          <OptionList
            options={options}
            render={(option) => (
              <ListboxOption
                value={option.value}
                disabled={option.disabled ?? false}
                className={CS_PICKER_OPTION}
              >
                {({ selected }) => (
                  <>
                    <span className={`${BOX} ${selected ? BOX_ON : ''}`} aria-hidden>
                      {selected ? '✓' : ''}
                    </span>
                    {option.label}
                  </>
                )}
              </ListboxOption>
            )}
          />
        </ListboxOptions>
      </div>
    </Listbox>
  )
}
