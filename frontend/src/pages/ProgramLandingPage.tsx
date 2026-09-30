import type { LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import { type Program, useProgram } from '../contexts/ProgramContext'
import { getProgramHomeUrl } from '../utils/programUrls'
import { BrandedLogo } from '../components/BrandedLogo'
import { useGlowGroup } from '../components/ui/useGlowGroup'
import { getCampName } from '../config/branding'
import { Users, Trees, Mountain, Sun, ArrowRight, Tent, BarChart3 } from 'lucide-react'

interface ProgramCardSpec {
  program: Program
  title: string
  description: string
  features: string[]
  cta: string
  Icon: LucideIcon
  /** Per-program colour classes. `glow` sets the glow-card's `--glow`. */
  tone: {
    glow: string
    iconBackdrop: string
    iconTile: string
    text: string
    headingHover: string
    dot: string
  }
}

// Cards are a fixed 295px with 20px gaps — the chosen mockup's size — so the
// row grows by whole cards rather than stretching them. Camperships joins as
// a fourth entry when /aid launches: four across is 1240px, too wide for the
// lg breakpoint, so at four use lg:grid-cols-[repeat(2,295px)] and
// xl:grid-cols-[repeat(4,295px)] (docs/reference/ui-uplift.md, "Landing page").
const PROGRAM_CARDS: ProgramCardSpec[] = [
  {
    program: 'summer',
    title: 'Summer Bunking',
    description: 'Youth cabin assignments',
    features: ['Session management', 'Bunk request matching', 'Cabin optimization'],
    cta: 'Enter Summer Bunking',
    Icon: Tent,
    tone: {
      glow: '', // the glow-card default, primary green
      iconBackdrop: 'bg-primary/10',
      iconTile: 'bg-primary/20',
      text: 'text-primary',
      headingHover: 'group-hover:text-primary',
      dot: 'bg-primary',
    },
  },
  {
    program: 'weekend',
    title: 'Weekend Housing',
    description: 'Family and weekend program housing',
    features: ['Family groupings', 'Relationship mapping', 'Quick assignments'],
    cta: 'Enter Weekend Housing',
    Icon: Users,
    tone: {
      glow: '[--glow:var(--color-amber-600)] dark:[--glow:var(--color-accent)]',
      iconBackdrop: 'bg-accent/10',
      iconTile: 'bg-accent/20',
      text: 'dark:text-accent text-amber-600',
      headingHover: 'dark:group-hover:text-accent group-hover:text-amber-600',
      dot: 'bg-accent',
    },
  },
  {
    program: 'analytics',
    title: 'Camp Analytics',
    description: 'Registration and retention analysis',
    features: ['Retention trends', 'Year-over-year comparison', 'Enrollment breakdowns'],
    cta: 'View Analytics',
    Icon: BarChart3,
    tone: {
      glow: '[--glow:var(--color-sky-500)]',
      iconBackdrop: 'bg-sky-500/10',
      iconTile: 'bg-sky-500/20',
      text: 'text-sky-600 dark:text-sky-400',
      headingHover: 'group-hover:text-sky-600 dark:group-hover:text-sky-400',
      dot: 'bg-sky-500',
    },
  },
]

function ProgramCard({
  card,
  stagger,
  onSelect,
}: {
  card: ProgramCardSpec
  stagger: number
  onSelect: () => void
}) {
  const { title, description, features, cta, Icon, tone } = card
  return (
    <button
      onClick={onSelect}
      className={`group animate-slide-up stagger-${stagger} relative`}
      style={{ animationFillMode: 'both' }}
    >
      <div
        data-glow-card=""
        className={`card-lodge glow-card flex h-full flex-col p-5 text-left lg:p-6 ${tone.glow}`}
      >
        {/* Icon */}
        <div className="relative mb-5 h-14 w-14">
          <div
            className={`absolute inset-0 rotate-6 rounded-xl transition-transform duration-300 group-hover:rotate-12 ${tone.iconBackdrop}`}
          />
          <div
            className={`absolute inset-0 flex items-center justify-center rounded-xl ${tone.iconTile}`}
          >
            <Icon className={`h-7 w-7 ${tone.text}`} />
          </div>
        </div>

        {/* Content */}
        <h2
          className={`font-display text-foreground mb-2 text-xl leading-tight font-bold transition-colors lg:text-2xl lg:leading-tight ${tone.headingHover}`}
        >
          {title}
        </h2>

        <p className="text-muted-foreground mb-4.5 text-sm leading-normal">{description}</p>

        {/* Features */}
        <ul className="mb-5.5 space-y-2">
          {features.map((feature) => (
            <li
              key={feature}
              className="text-muted-foreground flex items-center gap-2.5 text-sm leading-tight"
            >
              <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${tone.dot}`} />
              {feature}
            </li>
          ))}
        </ul>

        {/* CTA — pinned to the bottom, so the links line up across the row even
            when one description wraps */}
        <div className={`mt-auto flex items-center gap-2 text-sm font-semibold ${tone.text}`}>
          <span>{cta}</span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </div>
      </div>
    </button>
  )
}

export default function ProgramLandingPage() {
  const navigate = useNavigate()
  const { setProgram } = useProgram()
  const glow = useGlowGroup<HTMLDivElement>()

  const handleProgramSelect = (program: Program) => {
    setProgram(program)
    void navigate(getProgramHomeUrl(program))
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Ambient background layers */}
      <div className="from-background via-background to-forest-100/30 dark:to-forest-900/30 absolute inset-0 bg-gradient-to-b" />

      {/* Mountain silhouette */}
      <div className="absolute right-0 bottom-0 left-0 h-64 opacity-[0.03]">
        <svg viewBox="0 0 1440 320" className="h-full w-full" preserveAspectRatio="none">
          <path
            fill="currentColor"
            d="M0,224L60,213.3C120,203,240,181,360,181.3C480,181,600,203,720,197.3C840,192,960,160,1080,165.3C1200,171,1320,213,1380,234.7L1440,256L1440,320L1380,320C1320,320,1200,320,1080,320C960,320,840,320,720,320C600,320,480,320,360,320C240,320,120,320,60,320L0,320Z"
          />
        </svg>
      </div>

      {/* Decorative elements */}
      <div
        className="text-primary/5 animate-float absolute top-20 left-10"
        style={{ animationDelay: '0s' }}
      >
        <Trees className="h-24 w-24" />
      </div>
      <div
        className="text-accent/10 animate-float absolute top-40 right-16"
        style={{ animationDelay: '1s' }}
      >
        <Sun className="h-16 w-16" />
      </div>
      <div
        className="text-primary/5 animate-float absolute bottom-32 left-1/4"
        style={{ animationDelay: '2s' }}
      >
        <Mountain className="h-20 w-20" />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex min-h-screen flex-col items-center px-4 pt-12 pb-8 sm:pt-16">
        <div className="w-full max-w-7xl">
          {/* Logo and Title */}
          <div className="animate-fade-in mb-8 text-center sm:mb-10">
            <div className="mb-5 flex justify-center">
              <div className="relative">
                <div className="from-primary/10 via-accent/10 to-primary/10 absolute -inset-4 rounded-3xl bg-gradient-to-r blur-2xl" />
                <BrandedLogo size="large" className="relative" />
              </div>
            </div>

            <h1 className="font-display text-foreground mb-4 text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              {getCampName()}
            </h1>

            <p className="text-muted-foreground mx-auto max-w-xl text-base leading-relaxed sm:text-lg">
              Choose which program you're working on
            </p>
          </div>

          {/* Program Selection Cards — one pointer-tracked group, so a card's
              neighbours light their nearest edge too (useGlowGroup). */}
          <div
            {...glow}
            className="grid gap-5 sm:grid-cols-2 lg:grid-cols-[repeat(3,295px)] lg:justify-center"
          >
            {PROGRAM_CARDS.map((card, i) => (
              <ProgramCard
                key={card.program}
                card={card}
                stagger={i + 1}
                onSelect={() => handleProgramSelect(card.program)}
              />
            ))}
          </div>

          {/* Footer */}
          <div
            className="animate-fade-in mt-6 text-center"
            style={{ animationDelay: '0.4s', animationFillMode: 'both' }}
          >
            <p className="text-muted-foreground/70 text-sm">
              Your choice is remembered for next time
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
