/** Custom dot renderer that shows a hollow dashed circle on partial week data points. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function PartialWeekDot(props: any) {
  const { cx, cy, payload, stroke } = props
  if (!payload?.is_partial) return null
  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill="white"
      stroke={stroke}
      strokeWidth={2}
      strokeDasharray="3 3"
    />
  )
}
