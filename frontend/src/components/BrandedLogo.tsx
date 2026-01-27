import { branding, getLogoPath } from '../config/branding';

interface BrandedLogoProps {
  size?: 'small' | 'large';
  className?: string;
  /** Apply brightness filter for visibility on dark backgrounds */
  forDarkBg?: boolean;
}

/**
 * Branded logo component that displays the camp logo from branding config.
 * Falls back to text display if no logo is configured.
 */
export const BrandedLogo = ({ size = 'small', className = '', forDarkBg = false }: BrandedLogoProps) => {
  const isLarge = size === 'large';
  const logoPath = getLogoPath(isLarge ? 'large' : 'nav');

  const sizeClasses = isLarge
    ? 'w-80 h-auto' // ~320px wide for login page
    : 'h-20 w-auto'; // 80px tall for nav

  // For dark backgrounds, boost brightness to improve contrast
  const filterClasses = forDarkBg ? 'brightness-[1.25] contrast-[1.1]' : '';

  // If a logo path is configured, display the image
  if (logoPath) {
    return (
      <img
        src={logoPath}
        alt={branding.camp_name}
        className={`${sizeClasses} ${filterClasses} ${className}`}
      />
    );
  }

  // Fallback: text-based logo styled to match page title
  const textSizeClasses = isLarge
    ? 'text-4xl sm:text-5xl'
    : 'text-xl';

  return (
    <div className={`font-display font-bold text-foreground ${textSizeClasses} ${className}`}>
      {branding.camp_name_short}
    </div>
  );
};
