import { Users, Home, TrendingUp, AlertCircle, UserCheck } from 'lucide-react'
import { getGenderIdentityDisplay, getGenderCategory } from '../utils/genderUtils'
import type { Bunk, Camper } from '../types/app-types'

function utilizationColor(utilization: number): 'red' | 'yellow' | 'purple' {
  if (utilization >= 90) return 'red'
  if (utilization >= 70) return 'yellow'
  return 'purple'
}

interface SessionStatsProps {
  bunks: Bunk[]
  campers: Camper[]
  defaultCapacity?: number
}

export default function SessionStats({ bunks, campers, defaultCapacity = 12 }: SessionStatsProps) {
  const assignedCampers = campers.filter((c) => c.assigned_bunk)
  const unassignedCampers = campers.filter((c) => !c.assigned_bunk)

  // Calculate gender identity breakdown
  const genderBreakdown = campers.reduce(
    (acc, camper) => {
      const category = getGenderCategory(getGenderIdentityDisplay(camper))
      acc[category] = (acc[category] || 0) + 1
      return acc
    },
    {} as Record<'boys' | 'girls' | 'other', number>
  )

  const effectiveCapacity = bunks.reduce((sum, bunk) => {
    const assignedToBunk = campers.filter((c) => c.assigned_bunk === bunk.id).length
    return sum + Math.max(defaultCapacity, assignedToBunk)
  }, 0)

  const utilization = effectiveCapacity > 0 ? (assignedCampers.length / effectiveCapacity) * 100 : 0

  const stats = [
    {
      label: 'Total Campers',
      value: campers.length,
      detail: `${assignedCampers.length} assigned`,
      icon: Users,
      color: 'blue',
    },
    {
      label: 'Gender Identity',
      value: `${genderBreakdown.boys || 0}/${genderBreakdown.girls || 0}/${genderBreakdown.other || 0}`,
      detail: `Boys/Girls/Other`,
      icon: UserCheck,
      color: 'purple',
    },
    {
      label: 'Bunks',
      value: bunks.length,
      detail: `${
        bunks.filter((b) => {
          const occupancy = campers.filter((c) => c.assigned_bunk === b.id).length
          return occupancy > 0
        }).length
      } occupied`,
      icon: Home,
      color: 'green',
    },
    {
      label: 'Beds Filled',
      value: `${utilization.toFixed(0)}%`,
      detail: `${assignedCampers.length}/${effectiveCapacity} beds`,
      icon: TrendingUp,
      color: utilizationColor(utilization),
      progress: utilization,
    },
    {
      label: 'Unassigned',
      value: unassignedCampers.length,
      detail: unassignedCampers.length === 0 ? 'All assigned!' : 'Need placement',
      icon: AlertCircle,
      color: unassignedCampers.length > 0 ? 'orange' : 'gray',
    },
  ]

  const colorClasses = {
    blue: 'text-primary bg-primary/10',
    green: 'text-primary bg-secondary/20',
    purple: 'text-accent-foreground bg-accent/20',
    red: 'text-destructive bg-destructive/10',
    orange: 'text-accent-foreground bg-accent/10',
    yellow: 'text-accent-foreground bg-accent/20',
    gray: 'text-muted-foreground bg-muted',
  }

  const progressColorClasses = {
    purple: 'bg-primary',
    red: 'bg-destructive',
    yellow: 'bg-accent',
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
      {stats.map((stat) => {
        const Icon = stat.icon
        const colors = colorClasses[stat.color as keyof typeof colorClasses]
        const progressColor =
          stat.progress !== undefined && stat.color ? progressColorClasses[stat.color] : ''

        return (
          <div
            key={stat.label}
            className="bg-card border-border rounded-2xl border p-6 shadow-md transition-all hover:shadow-lg"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
                {stat.label}
              </span>
              <div className={`rounded-xl p-2.5 ${colors}`}>
                <Icon className="h-5 w-5" />
              </div>
            </div>
            <div className="text-foreground text-xl font-bold">{stat.value}</div>
            <div className="text-muted-foreground mt-1 text-sm">{stat.detail}</div>
            {stat.progress !== undefined && (
              <div className="bg-muted mt-3 h-2 w-full overflow-hidden rounded-full">
                <div
                  className={`${progressColor} h-2 rounded-full transition-all duration-500 ease-out`}
                  style={{ width: `${stat.progress}%` }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
