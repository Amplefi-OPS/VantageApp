/**
 * HHA duplicate-billing-id auditor.
 *
 * The importer's idempotency check resolves duplicate `Patient Billing ID`
 * values by overwriting the first occurrence with the second. Before we trust
 * that outcome, this script verifies that each duplicate group is the *same
 * person listed twice* (safe to merge) and not *two different people sharing a
 * billing ID* (data problem — we lost the first person's record).
 *
 * Usage:
 *   npx tsx packages/infra/scripts/audit-hha-duplicates.ts \
 *     --csv "/Users/pasta/appslefi/product artifacts/HHA-Config/DemographicsOfAllPatientsReport.csv"
 *
 * Output:
 *   - Summary counts (total dup groups, clean merges, needs-review)
 *   - Per-group detail for NEEDS_REVIEW cases (name/email/dob differ across rows)
 *   - Report file at tmp/hha-import/duplicate-audit.json
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

type Args = { csv: string };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return { csv: get('--csv') ?? '' };
}

function norm(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function normPhone(s: string | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

function toIsoDate(s: string | undefined): string {
  if (!s) return '';
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return s.trim();
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

type CsvRow = Record<string, string>;

type DupGroup = {
  billing_id: string;
  rows: CsvRow[];
  classification: 'CLEAN_MERGE' | 'NEEDS_REVIEW';
  variance: {
    first_name: Set<string>;
    last_name: Set<string>;
    dob: Set<string>;
    email: Set<string>;
    mobile_phone: Set<string>;
  };
};

function classify(group: Omit<DupGroup, 'classification'>): DupGroup['classification'] {
  const { first_name, last_name, dob, email, mobile_phone } = group.variance;
  // A "clean merge" means all identity fields match (empty counts as a wildcard —
  // missing data in one row doesn't disqualify it). Any disagreement on a
  // non-empty field across rows is a data problem worth a human review.
  const disagree = (s: Set<string>) => {
    const nonEmpty = [...s].filter(Boolean);
    return new Set(nonEmpty).size > 1;
  };
  if (disagree(first_name) || disagree(last_name) || disagree(dob) || disagree(email) || disagree(mobile_phone)) {
    return 'NEEDS_REVIEW';
  }
  return 'CLEAN_MERGE';
}

function main() {
  const { csv } = parseArgs();
  if (!csv) {
    console.error('ERROR: --csv <path> is required');
    process.exit(1);
  }

  const raw = readFileSync(csv, 'utf-8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as CsvRow[];
  console.log(`Parsed ${rows.length} rows`);

  const byBillingId = new Map<string, CsvRow[]>();
  for (const r of rows) {
    const id = (r['Patient Billing ID'] ?? '').trim();
    if (!id) continue;
    if (!byBillingId.has(id)) byBillingId.set(id, []);
    byBillingId.get(id)!.push(r);
  }

  const groups: DupGroup[] = [];
  for (const [billing_id, rs] of byBillingId) {
    if (rs.length < 2) continue;
    const variance = {
      first_name: new Set(rs.map(r => norm(r['First Name']))),
      last_name: new Set(rs.map(r => norm(r['Last Name']))),
      dob: new Set(rs.map(r => toIsoDate(r['Date of Birth']))),
      email: new Set(rs.map(r => norm(r['Email Address']))),
      mobile_phone: new Set(rs.map(r => normPhone(r['Mobile Phone']))),
    };
    const partial: Omit<DupGroup, 'classification'> = { billing_id, rows: rs, variance };
    groups.push({ ...partial, classification: classify(partial) });
  }

  const clean = groups.filter(g => g.classification === 'CLEAN_MERGE');
  const review = groups.filter(g => g.classification === 'NEEDS_REVIEW');

  console.log('\n── Duplicate billing-id audit ──');
  console.log(`  Total dup groups:     ${groups.length}`);
  console.log(`  CLEAN_MERGE:          ${clean.length}  (same person listed twice, importer kept latest — no action needed)`);
  console.log(`  NEEDS_REVIEW:         ${review.length}  (identity fields disagree across rows)`);

  if (review.length > 0) {
    console.log('\n── NEEDS_REVIEW detail ──');
    for (const g of review) {
      console.log(`\n  billing_id: ${g.billing_id}   (${g.rows.length} rows)`);
      const fmt = (label: string, s: Set<string>) => {
        const nonEmpty = [...s].filter(Boolean);
        if (new Set(nonEmpty).size <= 1) return;
        console.log(`    ${label}: ${[...s].map(v => JSON.stringify(v)).join(' | ')}`);
      };
      fmt('first_name  ', g.variance.first_name);
      fmt('last_name   ', g.variance.last_name);
      fmt('dob         ', g.variance.dob);
      fmt('email       ', g.variance.email);
      fmt('mobile_phone', g.variance.mobile_phone);
    }
  }

  mkdirSync('tmp/hha-import', { recursive: true });
  const report = {
    audited_at: new Date().toISOString(),
    csv,
    total_groups: groups.length,
    clean_merge: clean.length,
    needs_review: review.length,
    groups: groups.map(g => ({
      billing_id: g.billing_id,
      classification: g.classification,
      row_count: g.rows.length,
      variance: {
        first_name: [...g.variance.first_name],
        last_name: [...g.variance.last_name],
        dob: [...g.variance.dob],
        email: [...g.variance.email],
        mobile_phone: [...g.variance.mobile_phone],
      },
    })),
  };
  writeFileSync('tmp/hha-import/duplicate-audit.json', JSON.stringify(report, null, 2));
  console.log(`\nFull report: tmp/hha-import/duplicate-audit.json`);
}

main();
