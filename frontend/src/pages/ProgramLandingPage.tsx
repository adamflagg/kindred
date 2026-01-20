import { useNavigate } from 'react-router';
import { useProgram } from '../contexts/ProgramContext';
import { BrandedLogo } from '../components/BrandedLogo';
import { getCampName } from '../config/branding';
import { Users, Trees, Mountain, Sun, ArrowRight, Tent, BarChart3 } from 'lucide-react';

export default function ProgramLandingPage() {
  const navigate = useNavigate();
  const { setProgram } = useProgram();

  const handleProgramSelect = (program: 'summer' | 'family' | 'metrics') => {
    setProgram(program);
    if (program === 'summer') {
      navigate('/summer/sessions');
    } else if (program === 'family') {
      navigate('/family/');
    } else {
      navigate('/metrics');
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Ambient background layers */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-forest-100/30 dark:to-forest-900/30" />

      {/* Mountain silhouette */}
      <div className="absolute bottom-0 left-0 right-0 h-64 opacity-[0.03]">
        <svg viewBox="0 0 1440 320" className="w-full h-full" preserveAspectRatio="none">
          <path
            fill="currentColor"
            d="M0,224L60,213.3C120,203,240,181,360,181.3C480,181,600,203,720,197.3C840,192,960,160,1080,165.3C1200,171,1320,213,1380,234.7L1440,256L1440,320L1380,320C1320,320,1200,320,1080,320C960,320,840,320,720,320C600,320,480,320,360,320C240,320,120,320,60,320L0,320Z"
          />
        </svg>
      </div>

      {/* Decorative elements */}
      <div className="absolute top-20 left-10 text-primary/5 animate-float" style={{ animationDelay: '0s' }}>
        <Trees className="w-24 h-24" />
      </div>
      <div className="absolute top-40 right-16 text-accent/10 animate-float" style={{ animationDelay: '1s' }}>
        <Sun className="w-16 h-16" />
      </div>
      <div className="absolute bottom-32 left-1/4 text-primary/5 animate-float" style={{ animationDelay: '2s' }}>
        <Mountain className="w-20 h-20" />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center min-h-screen px-4 pt-12 sm:pt-16 pb-8">
        <div className="max-w-4xl w-full">

          {/* Logo and Title */}
          <div className="text-center mb-8 sm:mb-10 animate-fade-in">
            <div className="flex justify-center mb-5">
              <div className="relative">
                <div className="absolute -inset-4 bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 rounded-3xl blur-2xl" />
                <BrandedLogo size="large" className="relative" />
              </div>
            </div>

            <h1 className="text-3xl sm:text-4xl md:text-5xl font-display font-bold text-foreground mb-4 tracking-tight">
              {getCampName()}
            </h1>

            <p className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Choose which program you're working on
            </p>
          </div>

          {/* Program Selection Cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6 max-w-7xl mx-auto">

            {/* Summer Camp Card */}
            <button
              onClick={() => handleProgramSelect('summer')}
              className="group relative animate-slide-up stagger-1"
              style={{ animationFillMode: 'both' }}
            >
              <div className="absolute -inset-px bg-gradient-to-br from-primary/20 via-primary/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl" />

              <div className="relative card-lodge p-5 lg:p-6 h-full text-left group-hover:border-primary/40 group-hover:-translate-y-1 transition-all duration-300">
                {/* Decorative corner */}
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-primary/5 to-transparent rounded-2xl" />

                {/* Icon */}
                <div className="relative w-14 h-14 mb-5">
                  <div className="absolute inset-0 bg-primary/10 rounded-xl rotate-6 group-hover:rotate-12 transition-transform duration-300" />
                  <div className="absolute inset-0 bg-primary/20 rounded-xl flex items-center justify-center">
                    <Tent className="w-7 h-7 text-primary" />
                  </div>
                </div>

                {/* Content */}
                <h2 className="text-xl lg:text-2xl font-display font-bold text-foreground mb-2 group-hover:text-primary transition-colors">
                  Summer Camp
                </h2>

                <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                  Youth cabin assignments
                </p>

                {/* Features */}
                <ul className="space-y-2 mb-6">
                  {[
                    'Session management',
                    'Bunk request matching',
                    'Cabin optimization',
                  ].map((feature, i) => (
                    <li key={i} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <div className="flex items-center gap-2 text-primary font-semibold text-sm">
                  <span>Enter Summer Camp</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </button>

            {/* Family Camp Card */}
            <button
              onClick={() => handleProgramSelect('family')}
              className="group relative animate-slide-up stagger-2"
              style={{ animationFillMode: 'both' }}
            >
              <div className="absolute -inset-px bg-gradient-to-br from-accent/20 via-accent/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl" />

              <div className="relative card-lodge p-5 lg:p-6 h-full text-left group-hover:border-accent/40 group-hover:-translate-y-1 transition-all duration-300">
                {/* Decorative corner */}
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-accent/5 to-transparent rounded-2xl" />

                {/* Icon */}
                <div className="relative w-14 h-14 mb-5">
                  <div className="absolute inset-0 bg-accent/10 rounded-xl rotate-6 group-hover:rotate-12 transition-transform duration-300" />
                  <div className="absolute inset-0 bg-accent/20 rounded-xl flex items-center justify-center">
                    <Users className="w-7 h-7 text-amber-600 dark:text-accent" />
                  </div>
                </div>

                {/* Content */}
                <h2 className="text-xl lg:text-2xl font-display font-bold text-foreground mb-2 group-hover:text-amber-600 dark:group-hover:text-accent transition-colors">
                  Family Camp
                </h2>

                <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                  Family programs and adult retreats
                </p>

                {/* Features */}
                <ul className="space-y-2 mb-6">
                  {[
                    'Family groupings',
                    'Relationship mapping',
                    'Quick assignments',
                  ].map((feature, i) => (
                    <li key={i} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <div className="flex items-center gap-2 text-amber-600 dark:text-accent font-semibold text-sm">
                  <span>Enter Family Camp</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </button>

            {/* Metrics Card */}
            <button
              onClick={() => handleProgramSelect('metrics')}
              className="group relative animate-slide-up stagger-3"
              style={{ animationFillMode: 'both' }}
            >
              <div className="absolute -inset-px bg-gradient-to-br from-sky-500/20 via-sky-500/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl" />

              <div className="relative card-lodge p-5 lg:p-6 h-full text-left group-hover:border-sky-500/40 group-hover:-translate-y-1 transition-all duration-300">
                {/* Decorative corner */}
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-sky-500/5 to-transparent rounded-2xl" />

                {/* Icon */}
                <div className="relative w-14 h-14 mb-5">
                  <div className="absolute inset-0 bg-sky-500/10 rounded-xl rotate-6 group-hover:rotate-12 transition-transform duration-300" />
                  <div className="absolute inset-0 bg-sky-500/20 rounded-xl flex items-center justify-center">
                    <BarChart3 className="w-7 h-7 text-sky-600 dark:text-sky-400" />
                  </div>
                </div>

                {/* Content */}
                <h2 className="text-xl lg:text-2xl font-display font-bold text-foreground mb-2 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                  Metrics
                </h2>

                <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                  Registration and retention analysis
                </p>

                {/* Features */}
                <ul className="space-y-2 mb-6">
                  {[
                    'Retention trends',
                    'Year-over-year comparison',
                    'Enrollment breakdowns',
                  ].map((feature, i) => (
                    <li key={i} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-500 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 font-semibold text-sm">
                  <span>View Metrics</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </button>
          </div>

          {/* Footer */}
          <div className="text-center mt-6 animate-fade-in" style={{ animationDelay: '0.4s', animationFillMode: 'both' }}>
            <p className="text-sm text-muted-foreground/70">
              Your choice is remembered for next time
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
