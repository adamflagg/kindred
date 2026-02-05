import { useNavigate } from 'react-router'
import { useProgram } from '../contexts/ProgramContext'
import { BrandedLogo } from '../components/BrandedLogo'
import { getCampName } from '../config/branding'
import { Users, Trees, Mountain, Sun, ArrowRight, Tent, BarChart3 } from 'lucide-react'

export default function ProgramLandingPage() {
  const navigate = useNavigate()
  const { setProgram } = useProgram()

  const handleProgramSelect = (program: 'summer' | 'family' | 'metrics') => {
    setProgram(program)
    if (program === 'summer') {
      navigate('/summer/sessions')
    } else if (program === 'family') {
      navigate('/family/')
    } else {
      navigate('/metrics')
    }
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
        <div className="w-full max-w-4xl">
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

          {/* Program Selection Cards */}
          <div className="mx-auto grid max-w-7xl gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
            {/* Summer Camp Card */}
            <button
              onClick={() => handleProgramSelect('summer')}
              className="group animate-slide-up stagger-1 relative"
              style={{ animationFillMode: 'both' }}
            >
              <div className="from-primary/20 via-primary/5 absolute -inset-px rounded-2xl bg-gradient-to-br to-transparent opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100" />

              <div className="card-lodge group-hover:border-primary/40 relative h-full p-5 text-left transition-all duration-300 group-hover:-translate-y-1 lg:p-6">
                {/* Decorative corner */}
                <div className="from-primary/5 absolute top-0 right-0 h-24 w-24 rounded-2xl bg-gradient-to-bl to-transparent" />

                {/* Icon */}
                <div className="relative mb-5 h-14 w-14">
                  <div className="bg-primary/10 absolute inset-0 rotate-6 rounded-xl transition-transform duration-300 group-hover:rotate-12" />
                  <div className="bg-primary/20 absolute inset-0 flex items-center justify-center rounded-xl">
                    <Tent className="text-primary h-7 w-7" />
                  </div>
                </div>

                {/* Content */}
                <h2 className="font-display text-foreground group-hover:text-primary mb-2 text-xl font-bold transition-colors lg:text-2xl">
                  Summer Camp
                </h2>

                <p className="text-muted-foreground mb-5 text-sm leading-relaxed">
                  Youth cabin assignments
                </p>

                {/* Features */}
                <ul className="mb-6 space-y-2">
                  {['Session management', 'Bunk request matching', 'Cabin optimization'].map(
                    (feature, i) => (
                      <li
                        key={i}
                        className="text-muted-foreground flex items-center gap-2.5 text-sm"
                      >
                        <span className="bg-primary h-1.5 w-1.5 flex-shrink-0 rounded-full" />
                        {feature}
                      </li>
                    )
                  )}
                </ul>

                {/* CTA */}
                <div className="text-primary flex items-center gap-2 text-sm font-semibold">
                  <span>Enter Summer Camp</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </button>

            {/* Family Camp Card */}
            <button
              onClick={() => handleProgramSelect('family')}
              className="group animate-slide-up stagger-2 relative"
              style={{ animationFillMode: 'both' }}
            >
              <div className="from-accent/20 via-accent/5 absolute -inset-px rounded-2xl bg-gradient-to-br to-transparent opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100" />

              <div className="card-lodge group-hover:border-accent/40 relative h-full p-5 text-left transition-all duration-300 group-hover:-translate-y-1 lg:p-6">
                {/* Decorative corner */}
                <div className="from-accent/5 absolute top-0 right-0 h-24 w-24 rounded-2xl bg-gradient-to-bl to-transparent" />

                {/* Icon */}
                <div className="relative mb-5 h-14 w-14">
                  <div className="bg-accent/10 absolute inset-0 rotate-6 rounded-xl transition-transform duration-300 group-hover:rotate-12" />
                  <div className="bg-accent/20 absolute inset-0 flex items-center justify-center rounded-xl">
                    <Users className="dark:text-accent h-7 w-7 text-amber-600" />
                  </div>
                </div>

                {/* Content */}
                <h2 className="font-display text-foreground dark:group-hover:text-accent mb-2 text-xl font-bold transition-colors group-hover:text-amber-600 lg:text-2xl">
                  Family Camp
                </h2>

                <p className="text-muted-foreground mb-5 text-sm leading-relaxed">
                  Family programs and adult retreats
                </p>

                {/* Features */}
                <ul className="mb-6 space-y-2">
                  {['Family groupings', 'Relationship mapping', 'Quick assignments'].map(
                    (feature, i) => (
                      <li
                        key={i}
                        className="text-muted-foreground flex items-center gap-2.5 text-sm"
                      >
                        <span className="bg-accent h-1.5 w-1.5 flex-shrink-0 rounded-full" />
                        {feature}
                      </li>
                    )
                  )}
                </ul>

                {/* CTA */}
                <div className="dark:text-accent flex items-center gap-2 text-sm font-semibold text-amber-600">
                  <span>Enter Family Camp</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </button>

            {/* Metrics Card */}
            <button
              onClick={() => handleProgramSelect('metrics')}
              className="group animate-slide-up stagger-3 relative"
              style={{ animationFillMode: 'both' }}
            >
              <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-sky-500/20 via-sky-500/5 to-transparent opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100" />

              <div className="card-lodge relative h-full p-5 text-left transition-all duration-300 group-hover:-translate-y-1 group-hover:border-sky-500/40 lg:p-6">
                {/* Decorative corner */}
                <div className="absolute top-0 right-0 h-24 w-24 rounded-2xl bg-gradient-to-bl from-sky-500/5 to-transparent" />

                {/* Icon */}
                <div className="relative mb-5 h-14 w-14">
                  <div className="absolute inset-0 rotate-6 rounded-xl bg-sky-500/10 transition-transform duration-300 group-hover:rotate-12" />
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-sky-500/20">
                    <BarChart3 className="h-7 w-7 text-sky-600 dark:text-sky-400" />
                  </div>
                </div>

                {/* Content */}
                <h2 className="font-display text-foreground mb-2 text-xl font-bold transition-colors group-hover:text-sky-600 lg:text-2xl dark:group-hover:text-sky-400">
                  Metrics
                </h2>

                <p className="text-muted-foreground mb-5 text-sm leading-relaxed">
                  Registration and retention analysis
                </p>

                {/* Features */}
                <ul className="mb-6 space-y-2">
                  {['Retention trends', 'Year-over-year comparison', 'Enrollment breakdowns'].map(
                    (feature, i) => (
                      <li
                        key={i}
                        className="text-muted-foreground flex items-center gap-2.5 text-sm"
                      >
                        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-500" />
                        {feature}
                      </li>
                    )
                  )}
                </ul>

                {/* CTA */}
                <div className="flex items-center gap-2 text-sm font-semibold text-sky-600 dark:text-sky-400">
                  <span>View Metrics</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </button>
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
