import { useState, useEffect } from 'react';
import { X, HelpCircle } from 'lucide-react';

export interface ScaleGuideSidebarProps {
  activeCategory: string;
}

// Mini visual bar showing scale gradient
function MiniScaleBar({ colors }: { colors: string[] }) {
  return (
    <div className="h-2 rounded-full overflow-hidden flex mt-2">
      {colors.map((color, i) => (
        <div key={i} className={`flex-1 ${color}`} />
      ))}
    </div>
  );
}

// Individual scale card
function ScaleCard({
  title,
  range,
  color,
  items,
  barColors
}: {
  title: string;
  range: string;
  color: string;
  items: Array<{ label: string; desc: string }>;
  barColors: string[];
}) {
  return (
    <div className="bg-white/50 dark:bg-stone-800/50 rounded-lg p-4 border border-stone-200/50 dark:border-stone-700/50">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
        <span className="text-base font-semibold text-foreground">
          {title}
        </span>
        <span className="text-sm text-muted-foreground ml-auto font-medium">{range}</span>
      </div>
      <MiniScaleBar colors={barColors} />
      <div className="mt-3 space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex justify-between text-sm">
            <span className="text-muted-foreground font-medium">{item.label}</span>
            <span className="text-foreground/80">{item.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ScaleGuideSidebar({ activeCategory }: ScaleGuideSidebarProps) {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('scaleGuideOpen') === 'true';
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem('scaleGuideOpen', String(isOpen));
  }, [isOpen]);

  // Don't show on history tab - it doesn't have scale-based configs
  if (activeCategory === 'history') {
    return null;
  }

  // Tab-specific scale definitions
  const solverScales = [
    {
      title: 'Penalties',
      range: '0-10k',
      color: 'bg-amber-500',
      barColors: ['bg-sky-400', 'bg-amber-400', 'bg-orange-400', 'bg-red-400'],
      items: [
        { label: '< 1,500', desc: '~1-2 requests' },
        { label: '1.5-4k', desc: '~3-5 requests' },
        { label: '> 4k', desc: 'Critical rule' },
      ]
    },
    {
      title: 'Multipliers',
      range: '1-10x',
      color: 'bg-sky-500',
      barColors: ['bg-slate-300', 'bg-sky-400', 'bg-forest-400'],
      items: [
        { label: '1-3x', desc: 'Standard' },
        { label: '5x', desc: 'Prioritized' },
        { label: '10x', desc: 'Top priority' },
      ]
    },
    {
      title: 'Weights',
      range: '0-100',
      color: 'bg-forest-500',
      barColors: ['bg-slate-300', 'bg-amber-300', 'bg-forest-400'],
      items: [
        { label: '< 20', desc: 'Low impact' },
        { label: '20-60', desc: 'Balanced' },
        { label: '> 60', desc: 'High priority' },
      ]
    },
  ];

  const processingScales = [
    {
      title: 'Thresholds',
      range: '0-100%',
      color: 'bg-forest-500',
      barColors: ['bg-sky-400', 'bg-amber-400', 'bg-orange-400', 'bg-red-400'],
      items: [
        { label: '< 50%', desc: 'Lenient' },
        { label: '50-85%', desc: 'Balanced' },
        { label: '> 85%', desc: 'Strict' },
      ]
    },
    {
      title: 'Weights',
      range: '0-1',
      color: 'bg-sky-500',
      barColors: ['bg-slate-300', 'bg-sky-400', 'bg-forest-400'],
      items: [
        { label: '< 0.3', desc: 'Minor factor' },
        { label: '0.3-0.7', desc: 'Contributing' },
        { label: '> 0.7', desc: 'Primary factor' },
      ]
    },
    {
      title: 'Boosts',
      range: '0-50 pts',
      color: 'bg-amber-500',
      barColors: ['bg-slate-300', 'bg-amber-300', 'bg-amber-500'],
      items: [
        { label: '< 5', desc: 'Small nudge' },
        { label: '5-20', desc: 'Notable' },
        { label: '> 20', desc: 'Strong signal' },
      ]
    },
  ];

  const scales = activeCategory === 'solver' ? solverScales : processingScales;
  const tabLabel = activeCategory === 'solver' ? 'Bunk Optimizer' : 'Processing';

  return (
    <>
      {/* Floating toggle button - vertical text on right edge */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          fixed right-0 top-1/2 z-40
          flex items-center justify-center
          transition-all duration-300 ease-out
          ${isOpen ? 'translate-x-[340px]' : 'translate-x-0'}
        `}
        style={{ marginTop: '32px' }}
        aria-label="Toggle scale guide"
      >
        <div className={`
          flex items-center gap-1.5 px-2 py-4
          bg-gradient-to-b from-amber-100 to-amber-200
          dark:from-amber-900/80 dark:to-amber-800/80
          border border-r-0 border-amber-300 dark:border-amber-700
          rounded-l-xl shadow-lg
          hover:from-amber-200 hover:to-amber-300
          dark:hover:from-amber-800/80 dark:hover:to-amber-700/80
          transition-colors
          [writing-mode:vertical-rl] [text-orientation:mixed]
        `}>
          <HelpCircle className="w-4 h-4 text-amber-700 dark:text-amber-300 rotate-180" />
          <span className="text-xs font-bold tracking-wider text-amber-800 dark:text-amber-200 uppercase">
            Scales
          </span>
        </div>
      </button>

      {/* Sidebar panel */}
      <div
        className={`
          fixed right-0 z-30
          w-[340px]
          transform transition-transform duration-300 ease-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
        style={{ top: '64px', height: 'calc(100vh - 64px)' }}
      >
        {/* Glassmorphic background */}
        <div className="absolute inset-0 bg-stone-50/95 dark:bg-stone-900/95 backdrop-blur-xl border-l border-stone-200 dark:border-stone-700 shadow-2xl" />

        {/* Content */}
        <div className="relative h-full overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-gradient-to-b from-stone-100 to-stone-50/95 dark:from-stone-800 dark:to-stone-900/95 backdrop-blur-sm border-b border-stone-200 dark:border-stone-700 px-5 py-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  Scale Reference
                </h3>
                <p className="text-sm text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                  {tabLabel} Settings
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-stone-200 dark:hover:bg-stone-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* Scale cards */}
          <div className="p-4 space-y-4">
            {scales.map((scale, i) => (
              <ScaleCard key={i} {...scale} />
            ))}
          </div>

          {/* Footer hint */}
          <div className="sticky bottom-0 bg-gradient-to-t from-stone-100 dark:from-stone-900 to-transparent px-4 py-4">
            <p className="text-sm text-muted-foreground text-center leading-relaxed">
              Hover <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-stone-300 dark:bg-stone-600 text-xs font-bold align-middle mx-0.5">?</span> icons for details
            </p>
          </div>
        </div>
      </div>

      {/* Backdrop for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-20 lg:hidden"
          style={{ top: '64px' }}
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
