import React from 'react';
import clsx from 'clsx';

interface BunkUtilizationBarProps {
  utilization: number;
  occupancy: number;
  capacity: number;
}

export const BunkUtilizationBar = React.memo(function BunkUtilizationBar({ 
  utilization, 
  occupancy, 
  capacity 
}: BunkUtilizationBarProps) {
  const barColor = 
    occupancy > capacity ? 'bg-red-500' :
    utilization >= 90 ? 'bg-orange-500' :
    utilization >= 70 ? 'bg-yellow-500' :
    'bg-green-500';
    
  return (
    <div className="mb-3">
      <div className="w-full bg-muted rounded-full h-2">
        <div
          className={clsx('h-2 rounded-full transition-all', barColor)}
          style={{ 
            width: `${Math.min(100, utilization)}%`,
            willChange: 'width'
          }}
        />
      </div>
    </div>
  );
});