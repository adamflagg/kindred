/**
 * TODO(remove-before-merge): dev-only tuning panel for the merge/split
 * morph, per the owner's D27 ruling — duration, ease and stagger are tuned
 * ON THE REAL BOARD in the themed engine, then this file and its render
 * site are deleted and the chosen values land as `boardMorphConfig`'s
 * defaults. DEV-gated twice (the env check below and the render site), so
 * a production build never ships it even if the deletion is forgotten.
 */
import { useState } from 'react'

import { boardMorphConfig } from './boardMorphRunner'

const EASES = [
  'back.out(1.4)',
  'back.out(2)',
  'power3.out',
  'expo.out',
  'elastic.out(1, 0.6)',
  'power4.inOut',
]

export function BoardMorphTuner() {
  const [duration, setDuration] = useState(boardMorphConfig.duration)
  const [ease, setEase] = useState(boardMorphConfig.ease)
  const [stagger, setStagger] = useState(boardMorphConfig.stagger)
  const [nameEffect, setNameEffect] = useState(boardMorphConfig.nameEffect)
  if (!import.meta.env.DEV) return null
  return (
    <div className="border-border bg-card fixed right-3 bottom-36 z-40 flex flex-col gap-2 rounded-xl border p-3 text-xs shadow-lg">
      <span className="font-semibold">Morph tuner (dev only)</span>
      <label className="flex items-center justify-between gap-2">
        duration {duration.toFixed(2)}s
        <input
          type="range"
          min={0.3}
          max={1.4}
          step={0.05}
          value={duration}
          onChange={(e) => {
            const next = Number(e.target.value)
            boardMorphConfig.duration = next
            setDuration(next)
          }}
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        ease
        <select
          value={ease}
          onChange={(e) => {
            boardMorphConfig.ease = e.target.value
            setEase(e.target.value)
          }}
        >
          {EASES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2">
        stagger {stagger.toFixed(2)}s
        <input
          type="range"
          min={0}
          max={0.15}
          step={0.01}
          value={stagger}
          onChange={(e) => {
            const next = Number(e.target.value)
            boardMorphConfig.stagger = next
            setStagger(next)
          }}
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={nameEffect}
          onChange={(e) => {
            boardMorphConfig.nameEffect = e.target.checked
            setNameEffect(e.target.checked)
          }}
        />
        name crossfade
      </label>
    </div>
  )
}
