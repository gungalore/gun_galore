/**
 * THE DESK — the kit.
 *
 * One import surface for every Desk component. Import from here, never from
 * the individual files: it keeps the CI guard's job simple (one path to
 * allow) and it means a component can move file without touching a screen.
 *
 * ⚠️ NOTHING IN THIS DIRECTORY MAY IMPORT FROM components/admin/** OR
 * app/admin/(protected)/**. The Desk is a rebuild, not a reskin; the moment
 * one legacy component is wrapped rather than replaced, the old panel's
 * vocabulary is back. CI fails the build on any such import.
 */
export * from './icons';
export * from './primitives';
export * from './card';
export * from './numbers';
export * from './overlays';
export * from './states';
export * from './table';
export * from './tabs';
export * from './forms';
export * from './charts';
export * from './dialogs';
export * from './chat';
export * from './shell';
export * from './interactions';
export * from './use-undo';
export * from './listing-drawer';
export * from './member-drawer';
export * from './case-drawer';
export * from './send-drawer';
export * from './order-drawer';
