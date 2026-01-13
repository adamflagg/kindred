import { Users, Home, TrendingUp, AlertCircle, UserCheck } from 'lucide-react';
import { getGenderIdentityDisplay, getGenderCategory } from '../utils/genderUtils';
import type { Bunk, Camper } from '../types/app-types';

interface SessionStatsProps {
  bunks: Bunk[];
  campers: Camper[];
}

export default function SessionStats({ bunks, campers }: SessionStatsProps) {
  const assignedCampers = campers.filter(c => c.assigned_bunk);
  const unassignedCampers = campers.filter(c => !c.assigned_bunk);
  
  // Calculate gender identity breakdown
  const genderBreakdown = campers.reduce((acc, camper) => {
    const category = getGenderCategory(getGenderIdentityDisplay(camper));
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {} as Record<'boys' | 'girls' | 'other', number>);
  
  // Calculate effective capacity accounting for overfull bunks
  const effectiveCapacity = bunks.reduce((sum, bunk) => {
    const assignedToBunk = campers.filter(c => c.assigned_bunk === bunk.id).length;
    // If bunk is overfull, use actual occupancy as capacity for that bunk
    return sum + Math.max(bunk.capacity, assignedToBunk);
  }, 0);
  
  const utilization = effectiveCapacity > 0 ? (assignedCampers.length / effectiveCapacity) * 100 : 0;

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
      value: `${(genderBreakdown.boys || 0)}/${(genderBreakdown.girls || 0)}/${(genderBreakdown.other || 0)}`,
      detail: `Boys/Girls/Other`,
      icon: UserCheck,
      color: 'purple',
    },
    {
      label: 'Bunks',
      value: bunks.length,
      detail: `${bunks.filter(b => {
        const occupancy = campers.filter(c => c.assigned_bunk === b.id).length;
        return occupancy > 0;
      }).length} occupied`,
      icon: Home,
      color: 'green',
    },
    {
      label: 'Beds Filled',
      value: `${utilization.toFixed(0)}%`,
      detail: `${assignedCampers.length}/${effectiveCapacity} beds`,
      icon: TrendingUp,
      color: utilization >= 90 ? 'red' : utilization >= 70 ? 'yellow' : 'purple',
      progress: utilization,
    },
    {
      label: 'Unassigned',
      value: unassignedCampers.length,
      detail: unassignedCampers.length === 0 ? 'All assigned!' : 'Need placement',
      icon: AlertCircle,
      color: unassignedCampers.length > 0 ? 'orange' : 'gray',
    },
  ];

  const colorClasses = {
    blue: 'text-primary bg-primary/10',
    green: 'text-primary bg-secondary/20',
    purple: 'text-accent-foreground bg-accent/20',
    red: 'text-destructive bg-destructive/10',
    orange: 'text-accent-foreground bg-accent/10',
    yellow: 'text-accent-foreground bg-accent/20',
    gray: 'text-muted-foreground bg-muted',
  };

  const progressColorClasses = {
    purple: 'bg-primary',
    red: 'bg-destructive',
    yellow: 'bg-accent',
  };

  return (
    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      {stats.map((stat) => {
        const Icon = stat.icon;
        const colors = colorClasses[stat.color as keyof typeof colorClasses];
        const progressColor = stat.progress !== undefined && stat.color ? progressColorClasses[stat.color as keyof typeof progressColorClasses] : '';

        return (
          <div
            key={stat.label}
            className="bg-card rounded-2xl shadow-md p-6 hover:shadow-lg transition-all border border-border"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{stat.label}</span>
              <div className={`p-2.5 rounded-xl ${colors}`}>
                <Icon className="h-5 w-5" />
              </div>
            </div>
            <div className="text-xl font-bold text-foreground">{stat.value}</div>
            <div className="text-sm text-muted-foreground mt-1">{stat.detail}</div>
            {stat.progress !== undefined && (
              <div className="mt-3 w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className={`${progressColor} h-2 rounded-full transition-all duration-500 ease-out`}
                  style={{ width: `${stat.progress}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}