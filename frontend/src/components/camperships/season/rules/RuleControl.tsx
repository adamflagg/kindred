import { useState } from 'react'

import { CS_AMBER_NOTE, CS_INPUT, CS_PILL, CS_SELECT } from '../../kit/csType'
import { CHOICE_WORDS } from './rulesCards'
import { fieldName, type FieldSpec } from './sectionEdit'

const DECIMAL = /^\d+(\.\d*)?$/

/** Move a decimal string's point `by` places (2: fraction to percent; -2: back), without float maths. */
function shift(text: string, by: 2 | -2): string {
  const [whole = '0', fraction = ''] = text.split('.')
  let all = whole + fraction
  let point = whole.length + by
  if (point <= 0) {
    all = '0'.repeat(1 - point) + all
    point = 1
  }
  if (point > all.length) all = all.padEnd(point, '0')
  const int = all.slice(0, point).replace(/^0+(?=\d)/, '')
  const frac = all.slice(point).replace(/0+$/, '')
  return frac === '' ? int : `${int}.${frac}`
}

const toPercent = (fraction: string) => (DECIMAL.test(fraction) ? shift(fraction, 2) : fraction)
const toFraction = (percent: string) => (DECIMAL.test(percent) ? shift(percent, -2) : percent)

function NumberBox({
  path,
  spec,
  raw,
  onChange,
}: {
  path: readonly string[]
  spec: Extract<FieldSpec, { kind: 'number' }>
  raw: string
  onChange: (raw: string) => void
}) {
  const asPercent = spec.fraction === true
  // A fraction shows as a percent; what was typed is kept while it still means the stored fraction ("7." stays "7.").
  const [typed, setTyped] = useState<string | null>(null)
  const shown = !asPercent
    ? raw
    : typed !== null && toFraction(typed) === raw
      ? typed
      : toPercent(raw)
  return (
    <>
      {spec.unit === 'money' && <span className="text-muted-foreground">$</span>}
      <input
        type="text"
        inputMode="decimal"
        aria-label={fieldName(path)}
        className={`${CS_INPUT} w-28 text-right tabular-nums`}
        value={shown}
        placeholder={spec.nullable ? 'none' : undefined}
        onChange={(event) => {
          const text = event.target.value
          if (asPercent) setTyped(text)
          onChange(asPercent ? toFraction(text) : text)
        }}
      />
      {(spec.unit === 'percent' || asPercent) && <span className="text-muted-foreground">%</span>}
    </>
  )
}

/**
 * The box for one rules setting in the in-card editor (spec §6.2 F). `raw` is what the box holds in the
 * server's form (comma-joined for a list); `onChange` is called with the same.
 */
export function RuleControl({
  path,
  spec,
  raw,
  problem,
  onChange,
}: {
  path: readonly string[]
  value: unknown
  spec: FieldSpec
  raw: string
  problem: string | null
  onChange: (raw: string) => void
}) {
  const name = fieldName(path)
  const field = path.at(-1) ?? ''
  const chosen = raw === '' ? [] : raw.split(',')
  let body
  switch (spec.kind) {
    case 'yesno':
      body = (
        <input
          type="checkbox"
          aria-label={name}
          checked={raw === 'true'}
          onChange={(event) => onChange(String(event.target.checked))}
        />
      )
      break
    case 'choice':
      body = (
        <select
          aria-label={name}
          className={CS_SELECT}
          value={raw}
          onChange={(event) => onChange(event.target.value)}
        >
          {spec.options.map((option) => (
            <option key={option} value={option}>
              {CHOICE_WORDS[field]?.[option] ?? option.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      )
      break
    case 'pick':
      body = (
        <select
          aria-label={name}
          className={CS_SELECT}
          value={raw}
          onChange={(event) => onChange(event.target.value)}
        >
          {spec.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
      break
    case 'date':
      body = (
        <input
          type="date"
          aria-label={name}
          className={CS_INPUT}
          value={raw}
          onChange={(event) => onChange(event.target.value)}
        />
      )
      break
    case 'sessions': {
      const nameOf = (id: string) => spec.options.find((o) => String(o.id) === id)?.name ?? id
      const offered = spec.options.filter(
        (o) => !spec.claimed.has(o.id) && !chosen.includes(String(o.id))
      )
      body = (
        <span className="inline-flex flex-wrap items-center gap-1">
          {chosen.map((id) => (
            <span key={id} className={`${CS_PILL.muted} inline-flex items-center gap-1`}>
              {nameOf(id)}
              <button
                type="button"
                onClick={() => onChange(chosen.filter((c) => c !== id).join(','))}
              >
                ×
              </button>
            </span>
          ))}
          <select
            aria-label="Add a session"
            className={CS_SELECT}
            value=""
            onChange={(event) => {
              if (event.target.value !== '') onChange([...chosen, event.target.value].join(','))
            }}
          >
            <option value="">Add a session</option>
            {offered.map((o) => (
              <option key={o.id} value={String(o.id)}>
                {o.name}
              </option>
            ))}
          </select>
        </span>
      )
      break
    }
    case 'programs':
      body = (
        <span className="inline-flex flex-wrap items-center gap-x-3">
          {spec.options.map((option) => (
            <label key={option.key} className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={chosen.includes(option.key)}
                onChange={(event) =>
                  onChange(
                    (event.target.checked
                      ? [...chosen, option.key]
                      : chosen.filter((c) => c !== option.key)
                    ).join(',')
                  )
                }
              />
              {option.label}
            </label>
          ))}
        </span>
      )
      break
    case 'number':
      body = <NumberBox path={path} spec={spec} raw={raw} onChange={onChange} />
      break
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {body}
      {problem !== null && <span className={CS_AMBER_NOTE}>{problem}</span>}
    </span>
  )
}
