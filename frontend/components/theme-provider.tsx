'use client';

import { useTheme } from '@/lib/use-theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();

  return <>{children}</>;
}
