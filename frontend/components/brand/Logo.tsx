'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

type Props = {
  variant?: 'horizontal' | 'emblem';
  on?: 'light' | 'dark'; // background the logo sits on
  height?: number; // rendered height in px
  className?: string;
  priority?: boolean;
};

const RATIO = { horizontal: 5.882, emblem: 1.753 }; // width / height of the SVG artwork

export function Logo({ variant = 'horizontal', on: propOn = 'light', height = 36, className, priority }: Props) {
  // Read theme from DOM to always get current value
  const [on, setOn] = useState<'light' | 'dark'>(propOn);
  
  useEffect(() => {
    const updateOn = () => {
      const theme = document.documentElement.dataset.theme as 'light' | 'dark';
      console.log(`[Logo] DOM theme: ${theme}`);
      setOn(theme);
    };
    updateOn();
    const observer = new MutationObserver(updateOn);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const file = variant === 'horizontal' ? `logo-horizontal-${on}-transparent.svg` : `emblem-${on}-transparent.svg`;
  const min = variant === 'horizontal' ? 24 : 20; // below this the wordmark breaks down
  const h = Math.max(height, min);
  return (
    <Image
      key={`${variant}-${on}`} // Force re-render when variant or on changes
      src={`/brand/${file}`}
      alt="ALL Outdoor"
      height={h}
      width={Math.round(h * RATIO[variant])}
      className={className}
      priority={priority}
      unoptimized
    />
  );
}
