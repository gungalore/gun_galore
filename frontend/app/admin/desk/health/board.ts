/**
 * HEALTH — the one board endpoint, and the three arrays it carries.
 *
 * GET /admin/desk/site/board answers gates, channels and vitals in a single
 * request. It kept its path when the surface split, because renaming a live
 * endpoint to match a frontend route is a backend change with no operator
 * benefit — the name is now a fossil and this comment is the fossil record.
 *
 * 🚨 IT IS CALLED FROM EXACTLY ONE ROUTE, AND THAT IS A DECISION. The split
 * wanted vitals on Health and gates on Site; calling this from both would mean
 * TWO daemon round-trips per load, because desk.controller.ts awaits
 * `warden.checkBoard()` first on an 8-second read timeout — and a hung daemon
 * is precisely the state an operator is on this board to diagnose, so doubling
 * the wait is worst exactly when it is felt. All three arrays live here
 * instead, which is also the only arrangement where one endpoint keeps one
 * failure boundary.
 *
 * ⚠️ ANYTHING THIS PROCESS CANNOT MEASURE IS AN EM DASH, NEVER A ZERO. The
 * rule starts in desk-site.service.ts (`known: false`) and holds all the way
 * to the tile: "0% disk used" and "we could not measure the disk" are
 * different facts and only one of them is true.
 */
import { deskFetch } from '../../../../lib/desk-auth';

export type Tone = 'ok' | 'warn' | 'bad' | 'info';

export interface ConfigGate {
  key: string;
  label: string;
  value: string;
  tone: Tone;
  note?: string;
}

export interface VitalRow {
  key: string;
  label: string;
  known: boolean;
  value: string;
  tone: Tone;
  /**
   * Why an unmeasured tile is unmeasured, in Warden's own words.
   *
   * 🚨 THE SUB-LABEL USED TO BE A HARD-CODED "needs Warden on the box" for
   * every unknown tile. That was right while Warden was not deployed and
   * became wrong the moment it was: the nginx tiles are unmeasured because
   * Warden's service user is not in the `adm` group, and telling an operator
   * to deploy a daemon that is already running sends them to fix the wrong
   * thing. Absent means the server sent no reason.
   */
  reason?: string;
}

export interface ChannelRow {
  key: string;
  label: string;
  state: string;
  /**
   * ⚠️ `'neutral'` ARRIVES HERE DESPITE NOT BEING IN THIS UNION. The backend
   * casts it to GateTone in desk-site.service.ts — `tone: 'neutral' as
   * GateTone` — for an unmeasurable outbox and for WhatsApp while the flag is
   * off. So every reader must treat this as "ok, warn, bad, or something else
   * that is NOT a healthy state" and fall through to neutral, exactly as the
   * row below does. Widening the union here would make the mismatch invisible
   * rather than fixing it; the fix belongs on the backend's own type.
   */
  tone: Tone;
  detail: string;
}

export interface HealthBoard {
  gates: ConfigGate[];
  channels: ChannelRow[];
  vitals: VitalRow[];
}

export const fetchHealthBoard = () => deskFetch<HealthBoard>('/admin/desk/site/board');

/**
 * Is WhatsApp switched on, read off the CHANNEL ROW rather than off a setting.
 *
 * ⚠️ THIS USED TO READ `settings.find(s => s.key === 'whatsapp_enabled')`, and
 * the settings fetch is gone from this board with the settings panel. The
 * channel row is the same fact from the same service — desk-site.service.ts
 * builds its tone and its detail from `whatsappEnabled` — so nothing is being
 * inferred here. If the server ever stops sending a whatsapp channel, this
 * answers false, which draws the gated state: the weaker claim, deliberately.
 */
export function whatsappOn(channels: ChannelRow[]): boolean {
  return channels.find((c) => c.key === 'whatsapp')?.tone === 'ok';
}
