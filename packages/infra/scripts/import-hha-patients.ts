/**
 * HHA patient-demographics importer.
 *
 * Usage (from repo root):
 *   # Dry-run: writes transformed JSON to ./tmp/hha-import/ for inspection
 *   npx tsx packages/infra/scripts/import-hha-patients.ts \
 *       --csv "/Users/pasta/appslefi/product artifacts/HHA-Config/DemographicsOfAllPatientsReport.csv" \
 *       --dry-run
 *
 *   # Live: writes to DynamoDB + archives raw row to S3
 *   npx tsx packages/infra/scripts/import-hha-patients.ts \
 *       --csv "..." \
 *       --table vantage-emr-dev \
 *       --bucket vantage-emr-docs-dev-<account> \
 *       --region us-east-1
 *
 * Idempotency: legacy_billing_id is used as the dedupe key. If a patient with
 * the same legacy_billing_id already exists in DynamoDB (via GSI1 lookup), the
 * import reuses its patient_id and updates the profile rather than creating a
 * duplicate. Safe to re-run.
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

type Args = {
  csv: string;
  dryRun: boolean;
  table?: string;
  bucket?: string;
  region: string;
  limit?: number;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    csv: get('--csv') ?? '',
    dryRun: argv.includes('--dry-run'),
    table: get('--table'),
    bucket: get('--bucket'),
    region: get('--region') ?? 'us-east-1',
    limit: get('--limit') ? Number(get('--limit')) : undefined,
  };
}

// ── Normalizers ───────────────────────────────────────────────────

/** "11/11/1974" -> "1974-11-11". Returns undefined for blanks or unparseable. */
function toIsoDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

/** "Female" -> "F", "Male" -> "M", anything else -> "X" (blank stays undefined). */
function toSex(s: string | undefined): 'F' | 'M' | 'X' | undefined {
  if (!s) return undefined;
  const v = s.trim().toLowerCase();
  if (v.startsWith('f')) return 'F';
  if (v.startsWith('m')) return 'M';
  return 'X';
}

/** Strip formatting, keep digits. "(216) 555-0123" -> "2165550123". */
function normPhone(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const d = s.replace(/\D/g, '');
  return d.length >= 10 ? d : undefined;
}

function nonEmpty(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const v = s.trim();
  return v.length ? v : undefined;
}

function yesBool(s: string | undefined): boolean {
  return (s ?? '').trim().toLowerCase() === 'yes';
}

// ── Shape ─────────────────────────────────────────────────────────

interface EmergencyContact {
  name: string;
  relationship?: string;
  phone?: string;
}

interface FaceSheet {
  patient_id: string;
  legacy_billing_id?: string;
  source_system: 'HHA';
  imported_at: string;
  created_at?: string;

  first_name: string;
  middle_name?: string;
  last_name: string;
  dob?: string;
  sex?: 'F' | 'M' | 'X';

  email?: string;
  email_ok?: boolean;
  mobile_phone?: string;
  sms_ok?: boolean;
  home_phone?: string;

  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  timezone?: string;

  assigned_provider?: string;
  office_location?: string;

  emergency_contacts?: EmergencyContact[];
  notes?: string;
}

function transform(row: Record<string, string>, importedAt: string): FaceSheet {
  const emergency: EmergencyContact[] = [];
  for (const i of [1, 2, 3]) {
    const name = nonEmpty(row[`Emergency Contact Name ${i}`]);
    if (!name) continue;
    emergency.push({
      name,
      relationship: nonEmpty(row[`Emergency Contact\nRelationship ${i}`]),
      phone: normPhone(row[`Emergency Contact Phone ${i}`]),
    });
  }

  const address = {
    line1: nonEmpty(row['Address Line 1']),
    line2: nonEmpty(row['Address Line 2']),
    city: nonEmpty(row['City']),
    state: nonEmpty(row['State/Province']),
    zip: nonEmpty(row['Zip/Postal Code']),
  };
  const addressHasAny = Object.values(address).some(v => v !== undefined);

  const providerFirst = nonEmpty(row['Assigned To Provider\nFirst Name']);
  const providerLast = nonEmpty(row['Assigned To Provider\nLast Name']);
  const assigned_provider = [providerFirst, providerLast].filter(Boolean).join(' ') || undefined;

  return {
    patient_id: `pt_${randomUUID()}`,
    legacy_billing_id: nonEmpty(row['Patient Billing ID']),
    source_system: 'HHA',
    imported_at: importedAt,
    created_at: toIsoDate(row['Patient Creation Date']) ?? nonEmpty(row['Patient Creation Date']),

    first_name: nonEmpty(row['First Name']) ?? '',
    middle_name: nonEmpty(row['Middle Name']),
    last_name: nonEmpty(row['Last Name']) ?? '',
    dob: toIsoDate(row['Date of Birth']),
    sex: toSex(row['Gender']),

    email: nonEmpty(row['Email Address'])?.toLowerCase(),
    email_ok: yesBool(row['Email Address Approved']),
    mobile_phone: normPhone(row['Mobile Phone']),
    sms_ok: yesBool(row['Mobile Phone Approved']),
    home_phone: normPhone(row['Home Phone']),

    address: addressHasAny ? address : undefined,
    timezone: nonEmpty(row['Time Zone']),

    assigned_provider,
    office_location: nonEmpty(row['Office Location']),

    emergency_contacts: emergency.length ? emergency : undefined,
    notes: nonEmpty(row['Notes']),
  };
}

// ── DynamoDB item builders ────────────────────────────────────────

function profileItem(face: FaceSheet) {
  const lastFirst = `${face.last_name}#${face.first_name}`.toLowerCase();
  return {
    PK: `PATIENT#${face.patient_id}`,
    SK: 'PROFILE',
    GSI1PK: 'PATIENT',
    GSI1SK: lastFirst,
    entity_type: 'patient_profile',
    ...face,
  };
}

function legacyIndexItem(face: FaceSheet) {
  // Lets us look up "does this legacy_billing_id already exist?" with one GSI1 query.
  return {
    PK: `PATIENT#${face.patient_id}`,
    SK: `LEGACY#HHA#${face.legacy_billing_id}`,
    GSI1PK: 'LEGACY#HHA',
    GSI1SK: face.legacy_billing_id ?? '',
    entity_type: 'legacy_index',
    legacy_billing_id: face.legacy_billing_id,
    patient_id: face.patient_id,
  };
}

// ── Drivers ───────────────────────────────────────────────────────

async function findExistingPatientIdByLegacyId(
  doc: DynamoDBDocumentClient,
  table: string,
  legacyId: string,
): Promise<string | undefined> {
  const res = await doc.send(new QueryCommand({
    TableName: table,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
    ExpressionAttributeValues: { ':pk': 'LEGACY#HHA', ':sk': legacyId },
    Limit: 1,
  }));
  const hit = res.Items?.[0];
  return hit?.patient_id as string | undefined;
}

async function run() {
  const args = parseArgs();
  if (!args.csv) {
    console.error('ERROR: --csv <path> is required');
    process.exit(1);
  }
  if (!existsSync(args.csv)) {
    console.error(`ERROR: CSV not found at ${args.csv}`);
    process.exit(1);
  }
  if (!args.dryRun && (!args.table || !args.bucket)) {
    console.error('ERROR: live mode requires --table and --bucket (or use --dry-run)');
    process.exit(1);
  }

  const importedAt = new Date().toISOString();
  const importDay = importedAt.slice(0, 10); // YYYY-MM-DD

  const raw = readFileSync(args.csv, 'utf8').replace(/^﻿/, '');
  const rows: Record<string, string>[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });

  // HHA's CSV exporter injects repeated header rows throughout the file (one
  // per report page). They parse as "rows" where every field equals its column
  // name — e.g. First Name = "First Name". Drop them before transform so they
  // don't collide on a single bogus patient_id via the idempotency key.
  const isHeaderEcho = (r: Record<string, string>) =>
    (r['Patient Billing ID'] ?? '').trim() === 'Patient Billing ID';
  const preCount = rows.length;
  const clean = rows.filter(r => !isHeaderEcho(r));
  const droppedHeaders = preCount - clean.length;
  if (droppedHeaders > 0) {
    console.log(`Dropped ${droppedHeaders} repeated header rows from CSV`);
  }

  const limited = args.limit ? clean.slice(0, args.limit) : clean;
  console.log(`Parsed ${clean.length} data rows from CSV${args.limit ? ` (limiting to ${args.limit})` : ''}`);

  // Transform all
  const faceSheets = limited.map(r => ({ raw: r, face: transform(r, importedAt) }));

  // Integrity report
  const missingName = faceSheets.filter(f => !f.face.first_name || !f.face.last_name).length;
  const missingDob = faceSheets.filter(f => !f.face.dob).length;
  const missingContact = faceSheets.filter(f => !f.face.mobile_phone && !f.face.email).length;
  const missingLegacyId = faceSheets.filter(f => !f.face.legacy_billing_id).length;
  console.log('── Integrity report ──');
  console.log(`  Rows missing first or last name:    ${missingName}`);
  console.log(`  Rows missing DOB:                   ${missingDob}`);
  console.log(`  Rows missing email AND mobile:      ${missingContact}`);
  console.log(`  Rows missing legacy_billing_id:     ${missingLegacyId}`);

  if (args.dryRun) {
    const outDir = 'tmp/hha-import';
    mkdirSync(outDir, { recursive: true });
    // Write full array + 10 sample singles for eyeballing
    writeFileSync(`${outDir}/all-patients.json`, JSON.stringify(faceSheets.map(f => f.face), null, 2));
    const samples = faceSheets.slice(0, 10);
    samples.forEach((f, i) => {
      writeFileSync(`${outDir}/sample-${String(i + 1).padStart(2, '0')}.json`,
        JSON.stringify({ transformed: f.face, raw: f.raw }, null, 2));
    });
    console.log(`\nDRY RUN — wrote ${faceSheets.length} records to ${outDir}/all-patients.json`);
    console.log(`Wrote ${samples.length} side-by-side samples to ${outDir}/sample-*.json`);
    console.log('Inspect a sample:  cat tmp/hha-import/sample-01.json');
    return;
  }

  // LIVE mode — write to Dynamo + S3
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: args.region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const s3 = new S3Client({ region: args.region });

  let created = 0;
  let updated = 0;
  let archived = 0;

  for (const { raw: rawRow, face } of faceSheets) {
    if (face.legacy_billing_id) {
      const existing = await findExistingPatientIdByLegacyId(ddb, args.table!, face.legacy_billing_id);
      if (existing) {
        face.patient_id = existing;
        updated++;
      } else {
        created++;
      }
    } else {
      created++;
    }

    const items = [profileItem(face)];
    if (face.legacy_billing_id) items.push(legacyIndexItem(face));

    // BatchWrite caps at 25 items; we're well under.
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [args.table!]: items.map(Item => ({ PutRequest: { Item } })),
      },
    }));

    // Archive raw CSV row as immutable JSON for audit + future re-derivation.
    const archiveKey = `imports/HHA/${importDay}/${face.legacy_billing_id ?? face.patient_id}.json`;
    await s3.send(new PutObjectCommand({
      Bucket: args.bucket!,
      Key: archiveKey,
      Body: JSON.stringify({ imported_at: importedAt, patient_id: face.patient_id, raw: rawRow }, null, 2),
      ContentType: 'application/json',
      ServerSideEncryption: 'aws:kms',
    }));
    archived++;
  }

  console.log(`\nLIVE IMPORT complete.`);
  console.log(`  Created:  ${created}`);
  console.log(`  Updated:  ${updated}`);
  console.log(`  Archived: ${archived}  (s3://${args.bucket}/imports/HHA/${importDay}/)`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
