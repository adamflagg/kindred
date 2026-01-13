import clsx from 'clsx';

export interface TableColumn<T> {
  key: string;
  header: string;
  width: string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  className?: string;
  renderCell?: (item: T) => React.ReactNode;
}

// Helper to generate grid template columns from column definitions
export function getGridColumns<T>(columns: Array<TableColumn<T>>): string {
  return columns.map(col => col.width).join(' ');
}

// Helper to get cell alignment classes
export function getCellAlignment(align?: 'left' | 'center' | 'right'): string {
  switch (align) {
    case 'center':
      return 'flex items-center justify-center';
    case 'right':
      return 'flex items-center justify-end';
    default:
      return 'flex items-center'; // left is default
  }
}

// Helper for sort indicator text
export function getSortIndicator(sortBy: string, sortOrder: 'asc' | 'desc', columnKey: string): string {
  if (sortBy !== columnKey) return '';
  return sortOrder === 'asc' ? '↑' : '↓';
}

// Row styles generator with pseudo-border pattern
export function getVirtualRowStyles(virtualItem: { start: number }, hasHover = true) {
  return {
    className: clsx(
      'min-w-[900px] relative',
      hasHover && 'hover:bg-muted/50',
      'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1px] after:bg-border'
    ),
    style: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      width: '100%',
      transform: `translateY(${virtualItem.start}px)`,
      willChange: 'transform',
    }
  };
}

// Badge styles helper
export interface BadgeConfig {
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'xs' | 'sm' | 'md';
}

export function getBadgeClasses({ variant = 'default', size = 'sm' }: BadgeConfig = {}): string {
  const sizeClasses = {
    xs: 'px-1.5 py-0.5 text-xs',
    sm: 'px-2 py-1 text-xs',
    md: 'px-2.5 py-1.5 text-sm'
  };

  const variantClasses = {
    default: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    primary: 'bg-primary/10 text-primary dark:bg-primary/20',
    success: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
    danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
  };

  return clsx(
    'inline-flex font-medium rounded-full whitespace-nowrap',
    sizeClasses[size],
    variantClasses[variant]
  );
}

// Column width recommendations
export const columnWidths = {
  // Checkbox/small icon columns
  checkbox: '40px',
  icon: '50px',
  
  // Text columns
  name: 'minmax(180px,2fr)',      // Primary text, flexible
  description: 'minmax(200px,3fr)', // Long text, more flexible
  
  // Numeric columns  
  age: 'minmax(60px,80px)',        // 2-3 digits
  grade: 'minmax(60px,80px)',      // 1-2 digits
  count: 'minmax(80px,100px)',     // 1-4 digits
  
  // Status/Badge columns
  status: 'minmax(100px,120px)',   // Short badges
  badge: 'minmax(90px,110px)',     // Single badge
  type: 'minmax(120px,140px)',     // Medium badges
  gender: 'minmax(60px,80px)',     // M/F/NB badges
  genderIdentity: 'minmax(140px,160px)', // Longer gender identity
  
  // Other columns
  session: 'minmax(100px,140px)',  // Session names
  bunk: 'minmax(80px,100px)',      // Bunk codes
  actions: 'minmax(100px,120px)',  // 2-3 action buttons
  
  // Priority based columns
  priority: 'minmax(80px,100px)',  // Priority numbers
  confidence: 'minmax(90px,110px)', // Percentage values
};