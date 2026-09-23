// components/brand/Logo.tsx - always use this, never an <img> with a hand-picked file.
// Files live in /public/brand (see nextjs-metadata.ts). "light" artwork = for light backgrounds.
import Image from "next/image";

type Props = {
  variant?: "horizontal" | "emblem";
  on?: "light" | "dark";   // background the logo sits on
  height?: number;          // rendered height in px
  className?: string;
  priority?: boolean;
};

const RATIO = { horizontal: 5.882, emblem: 1.753 }; // width / height of the SVG artwork

export function Logo({ variant = "horizontal", on = "light", height = 36, className, priority }: Props) {
  const file = variant === "horizontal" ? `logo-horizontal-${on}-transparent.svg` : `emblem-${on}-transparent.svg`;
  const min = variant === "horizontal" ? 24 : 20; // below this the wordmark breaks down
  const h = Math.max(height, min);
  return (
    <Image src={`/brand/${file}`} alt="ALL Outdoor" height={h} width={Math.round(h * RATIO[variant])}
      className={className} priority={priority} unoptimized />
  );
}
