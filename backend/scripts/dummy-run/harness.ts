/**
 * Dummy-run harness core: a tiny test reporter + assertion helpers + a money
 * ledger. Deliberately dependency-free (no jest) so it runs inside the booted
 * Nest context. Every module driver records PASS/FAIL steps here; at the end we
 * print a summary + write DUMMY-RUN-REPORT.md.
 */
import * as fs from 'node:fs';

export type ModuleStatus = 'PASS' | 'FAIL' | 'PARTIAL' | 'SKIP';

export interface StepResult {
  desc: string;
  ok: boolean;
  detail?: string;
}

export interface Bug {
  module: string;
  location: string; // file:line
  symptom: string;
  assertion: string;
}

// One money-flow row per settled lifecycle. All amounts ZAR cents.
export interface LedgerEntry {
  module: string;
  label: string;
  buyerPaid: number; // what the buyer(s) put in
  sellerPaid: number; // seller payout(s)
  ggRevenue: number; // commission + processing + handling + flat swap fees
  carrier: number; // shipping remitted to courier
  refunded: number; // money returned to buyers
  note?: string;
}

interface ModuleRecord {
  name: string;
  status: ModuleStatus;
  steps: StepResult[];
  error?: string;
}

const R = (cents: number) => `R${(cents / 100).toFixed(2)}`;

export class Reporter {
  modules: ModuleRecord[] = [];
  bugs: Bug[] = [];
  ledger: LedgerEntry[] = [];
  private current: ModuleRecord | null = null;

  begin(name: string) {
    this.current = { name, status: 'PASS', steps: [] };
    this.modules.push(this.current);
    console.log('');
    console.log(`──────── MODULE: ${name} ────────`);
  }

  step(desc: string, ok: boolean, detail?: string) {
    if (!this.current) throw new Error('step() called outside a module');
    this.current.steps.push({ desc, ok, detail });
    const tag = ok ? '  ✓ PASS' : '  ✗ FAIL';
    console.log(`${tag}  ${desc}${detail ? `  — ${detail}` : ''}`);
    if (!ok && this.current.status === 'PASS') this.current.status = 'PARTIAL';
  }

  pass(desc: string, detail?: string) {
    this.step(desc, true, detail);
  }

  fail(desc: string, detail?: string) {
    this.step(desc, false, detail);
  }

  /** Record a genuine PRODUCT bug (not a harness mistake). */
  bug(location: string, symptom: string, assertion: string) {
    if (!this.current) throw new Error('bug() called outside a module');
    this.bugs.push({ module: this.current.name, location, symptom, assertion });
    console.log(`  ⚠ PRODUCT BUG @ ${location} — ${symptom}`);
  }

  money(entry: Omit<LedgerEntry, 'module'>) {
    const module = this.current?.name ?? '(global)';
    this.ledger.push({ module, ...entry });
  }

  /** Mark the module's terminal status. Auto: PASS if all steps ok, else PARTIAL. */
  end(forced?: ModuleStatus, error?: string) {
    if (!this.current) return;
    if (error) this.current.error = error;
    if (forced) {
      this.current.status = forced;
    } else if (this.current.steps.some((s) => !s.ok)) {
      this.current.status = this.current.steps.every((s) => !s.ok)
        ? 'FAIL'
        : 'PARTIAL';
    } else {
      this.current.status = 'PASS';
    }
    console.log(`  ⇒ ${this.current.name}: ${this.current.status}`);
    this.current = null;
  }

  printSummary() {
    console.log('');
    console.log('════════════════════ SUMMARY ════════════════════');
    for (const m of this.modules) {
      const passed = m.steps.filter((s) => s.ok).length;
      console.log(
        `  ${m.status.padEnd(8)} ${m.name}  (${passed}/${m.steps.length} steps)`,
      );
    }
    console.log(`  Product bugs found: ${this.bugs.length}`);
    console.log('══════════════════════════════════════════════════');
  }

  writeMarkdown(path: string) {
    const lines: string[] = [];
    const now = new Date().toISOString();
    lines.push('# Gun Galore — End-to-End Dummy Run Report');
    lines.push('');
    lines.push(`Generated: ${now}`);
    lines.push('');
    lines.push(
      'Fully offline simulation against the isolated throwaway DB ' +
        '`gun_galore_dummyrun`. Every external integration (payments gateway, ' +
        'courier, KYC, email/SMS, Zoho, Cloudinary, Anthropic) is a no-op/stub. ' +
        'The harness calls the REAL service methods and invokes each sweep ' +
        'directly (all crons stopped).',
    );
    lines.push('');

    // ── Module results table ──
    lines.push('## Module results');
    lines.push('');
    lines.push('| Module | Result | Steps (pass/total) |');
    lines.push('|---|---|---|');
    for (const m of this.modules) {
      const passed = m.steps.filter((s) => s.ok).length;
      lines.push(`| ${m.name} | **${m.status}** | ${passed}/${m.steps.length} |`);
    }
    lines.push('');

    // ── Per-module step detail ──
    lines.push('## Step detail');
    lines.push('');
    for (const m of this.modules) {
      lines.push(`### ${m.name} — ${m.status}`);
      if (m.error) lines.push(`> module aborted: \`${m.error}\``);
      lines.push('');
      for (const s of m.steps) {
        const mark = s.ok ? '✅' : '❌';
        lines.push(`- ${mark} ${s.desc}${s.detail ? ` — ${s.detail}` : ''}`);
      }
      lines.push('');
    }

    // ── Money ledger ──
    lines.push('## Money-conservation ledger');
    lines.push('');
    lines.push('All amounts ZAR. For every settled lifecycle:');
    lines.push('');
    lines.push('`buyerPaid == sellerPaid + ggRevenue + carrier + refunded`');
    lines.push('');
    lines.push(
      '| Module | Flow | Buyer in | Seller out | GG revenue | Carrier | Refunded | Balances? |',
    );
    lines.push('|---|---|--:|--:|--:|--:|--:|:--:|');
    const tot = { buyerPaid: 0, sellerPaid: 0, ggRevenue: 0, carrier: 0, refunded: 0 };
    for (const e of this.ledger) {
      const lhs = e.buyerPaid;
      const rhs = e.sellerPaid + e.ggRevenue + e.carrier + e.refunded;
      const bal = lhs === rhs ? '✅' : `❌ Δ${R(lhs - rhs)}`;
      lines.push(
        `| ${e.module} | ${e.label} | ${R(e.buyerPaid)} | ${R(e.sellerPaid)} | ${R(e.ggRevenue)} | ${R(e.carrier)} | ${R(e.refunded)} | ${bal} |`,
      );
      tot.buyerPaid += e.buyerPaid;
      tot.sellerPaid += e.sellerPaid;
      tot.ggRevenue += e.ggRevenue;
      tot.carrier += e.carrier;
      tot.refunded += e.refunded;
    }
    const totRhs = tot.sellerPaid + tot.ggRevenue + tot.carrier + tot.refunded;
    lines.push(
      `| **TOTAL** | | **${R(tot.buyerPaid)}** | **${R(tot.sellerPaid)}** | **${R(tot.ggRevenue)}** | **${R(tot.carrier)}** | **${R(tot.refunded)}** | ${tot.buyerPaid === totRhs ? '✅' : `❌ Δ${R(tot.buyerPaid - totRhs)}`} |`,
    );
    lines.push('');

    // ── Bugs ──
    lines.push('## Bugs found (product code, not harness)');
    lines.push('');
    if (this.bugs.length === 0) {
      lines.push('_None — every driven flow behaved as expected._');
    } else {
      for (const b of this.bugs) {
        lines.push(`### [${b.module}] ${b.location}`);
        lines.push(`- **Symptom:** ${b.symptom}`);
        lines.push(`- **Failing assertion:** ${b.assertion}`);
        lines.push('');
      }
    }
    lines.push('');

    fs.writeFileSync(path, lines.join('\n'));
    console.log(`\n[report] wrote ${path}`);
  }
}

// ── Assertion primitives (throw on failure; module catch records them) ──
export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function eq(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/**
 * Run an assertion block as ONE reported step. Returns true on pass. Never
 * throws — a failed assertion is recorded as a FAIL step and the module
 * continues (so one bad step doesn't abort the whole module).
 */
export function check(rep: Reporter, desc: string, fn: () => void): boolean {
  try {
    fn();
    rep.pass(desc);
    return true;
  } catch (e) {
    rep.fail(desc, (e as Error).message);
    return false;
  }
}

export async function checkAsync(
  rep: Reporter,
  desc: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  try {
    await fn();
    rep.pass(desc);
    return true;
  } catch (e) {
    rep.fail(desc, (e as Error).message);
    return false;
  }
}

export { R as rands };
