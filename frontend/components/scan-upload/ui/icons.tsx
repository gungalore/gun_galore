import type { ReactElement } from 'react';

export type IconName =
  | 'close'
  | 'back'
  | 'forward'
  | 'help'
  | 'camera'
  | 'photos'
  | 'doc'
  | 'card'
  | 'pages'
  | 'check'
  | 'alert'
  | 'flash'
  | 'flashOff'
  | 'trash'
  | 'plus'
  | 'upload'
  | 'spark'
  | 'move'
  | 'hand'
  | 'sun'
  | 'glare'
  | 'lock'
  | 'cameraOff'
  | 'rotate'
  | 'corners'
  | 'zoomIn'
  | 'zoomOut';

const PATHS: Record<IconName, string> = {
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  photos: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M16 9h.01',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  card: 'M3 6h18v12H3zM3 10h18M7 14h4',
  pages: 'M4 7h12v14H4zM8 3h10a2 2 0 0 1 2 2v12',
  check: 'M5 12.5l4.5 4.5L19 7',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  flash: 'M13 2L5 13h6l-1 9 8-11h-6z',
  flashOff: 'M13 2L5 13h6l-1 9 8-11h-6zM3 3l18 18',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 16V4M6 10l6-6 6 6M4 20h16',
  spark: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  move: 'M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4',
  hand: 'M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V13M8 13l-2-2a1.6 1.6 0 0 0-2.3 2.2L8 18a6 6 0 0 0 9 2l.5-.5A4 4 0 0 0 19 16.5V13',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  glare: 'M4 4l16 16M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M2 12h2M20 12h2',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  cameraOff: 'M3 3l18 18M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  rotate: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  corners: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14',
  zoomIn: 'M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM20 20l-4.5-4.5M11 8v6M8 11h6',
  zoomOut: 'M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM20 20l-4.5-4.5M8 11h6',
};

export function Icon({ name, size = 24, color = 'currentColor', stroke = 2 }: { name: IconName; size?: number; color?: string; stroke?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
