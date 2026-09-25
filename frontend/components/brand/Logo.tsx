import Image from 'next/image';

type LogoOn = 'light' | 'dark';

type Props = {
  variant?: 'horizontal' | 'emblem';
  /**
   * Force the artwork for a fixed background. Must be a constant — never a
   * theme-derived value, because the server cannot know the client theme and
   * React does not patch attribute mismatches during hydration. Leave unset
   * on theme-following surfaces; the artwork then swaps via CSS off the
   * pre-paint `data-theme` attribute (see app/globals.css).
   */
  on?: LogoOn;
  height?: number; // rendered height in px
  className?: string;
  priority?: boolean;
};

const RATIO = { horizontal: 5.882, emblem: 1.753 }; // width / height of the SVG artwork

function fileFor(variant: 'horizontal' | 'emblem', on: LogoOn) {
  return variant === 'horizontal'
    ? `/brand/logo-horizontal-${on}-transparent.svg`
    : `/brand/emblem-${on}-transparent.svg`;
}

export function Logo({ variant = 'horizontal', on, height = 36, className, priority }: Props) {
  const min = variant === 'horizontal' ? 24 : 20; // below this the wordmark breaks down
  const h = Math.max(height, min);
  const width = Math.round(h * RATIO[variant]);

  // Explicit background — a single, stable image.
  if (on) {
    return (
      <Image
        src={fileFor(variant, on)}
        alt="ALL Outdoor"
        height={h}
        width={width}
        className={className}
        priority={priority}
        unoptimized
      />
    );
  }

  // Theme-following. Both artworks are server-rendered identically and CSS
  // hides the wrong one using the pre-paint `data-theme` attribute, so the
  // correct lockup is painted on the first frame with no hydration mismatch.
  return (
    <>
      <Image
        src={fileFor(variant, 'light')}
        alt="ALL Outdoor"
        height={h}
        width={width}
        className={`aos-logo-on-light${className ? ` ${className}` : ''}`}
        priority={priority}
        unoptimized
      />
      <Image
        src={fileFor(variant, 'dark')}
        alt="ALL Outdoor"
        height={h}
        width={width}
        className={`aos-logo-on-dark${className ? ` ${className}` : ''}`}
        priority={priority}
        unoptimized
      />
    </>
  );
}
