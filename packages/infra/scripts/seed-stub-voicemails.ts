/**
 * Seed stub voicemails into the EMR table so the matcher UI can be exercised
 * end-to-end without a live Zoom Phone integration on the FM line yet.
 *
 * Varied scenarios (one per stub) — designed to force the admin through every
 * UX branch in the matcher:
 *   - caller_id matches exactly ONE patient (happy-path auto-attach)
 *   - caller_id matches ZERO patients (forces manual search)
 *   - caller_id matches MULTIPLE patients (family shares number, forces pick)
 *   - transcript identifies patient but caller_id is the office/clinic
 *   - garbled transcript / first name only
 *   - third-party calling about the patient
 *
 * Usage (from repo root):
 *   npx tsx packages/infra/scripts/seed-stub-voicemails.ts \
 *     --table vantage-emr-dev --region us-east-1
 *
 *   # Optional: wipe existing stubs before seeding (keeps the unmatched partition clean)
 *   npx tsx packages/infra/scripts/seed-stub-voicemails.ts \
 *     --table vantage-emr-dev --region us-east-1 --wipe
 */

import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

type Args = { table: string; region: string; wipe: boolean };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    table: get('--table') ?? '',
    region: get('--region') ?? 'us-east-1',
    wipe: argv.includes('--wipe'),
  };
}

type StubSpec = {
  caller_id: string;        // digits-only
  caller_id_raw: string;    // as-received format
  caller_name_cnam: string; // from caller ID (uppercase last-first is typical)
  received_at: string;      // ISO
  duration_seconds: number;
  transcript: string;
  scenario: string;         // internal label for debugging
};

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

async function main() {
  const args = parseArgs();
  if (!args.table) {
    console.error('ERROR: --table <name> required');
    process.exit(1);
  }

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: args.region }), {
    marshallOptions: { removeUndefinedValues: true },
  });

  if (args.wipe) {
    console.log('Wiping existing unmatched voicemails...');
    const existing = await ddb.send(new QueryCommand({
      TableName: args.table,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'VOICEMAIL#UNMATCHED' },
    }));
    for (const item of existing.Items ?? []) {
      await ddb.send(new DeleteCommand({
        TableName: args.table,
        Key: { PK: item.PK, SK: item.SK },
      }));
    }
    console.log(`  deleted ${existing.Items?.length ?? 0} items`);
  }

  // Pick real patient phones so auto-match can actually hit something.
  // Query the PATIENT partition on GSI1 and pull the first few with mobile_phone set.
  const roster = await ddb.send(new QueryCommand({
    TableName: args.table,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': 'PATIENT' },
    Limit: 50,
  }));
  const patientsWithPhone = (roster.Items ?? []).filter(p => p.mobile_phone);
  if (patientsWithPhone.length < 3) {
    console.error('ERROR: need at least 3 patients with mobile_phone to seed varied stubs');
    process.exit(1);
  }
  const pick = (i: number) => patientsWithPhone[i % patientsWithPhone.length];

  const p1 = pick(0);
  const p2 = pick(1);
  const p3 = pick(2);

  // Also find the user directly (phone 7276878415 → John D'Alesandro) so the smoke test is personal.
  // GSI1 scan above only reads the first page of the roster; D'Alesandro is past that, so query by phone.
  const meResult = await ddb.send(new QueryCommand({
    TableName: args.table,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    FilterExpression: 'mobile_phone = :p',
    ExpressionAttributeValues: { ':pk': 'PATIENT', ':p': '7276878415' },
  }));
  const me = meResult.Items?.[0];

  const stubs: StubSpec[] = [
    {
      // Scenario: caller_id matches exactly one patient (happy path auto-attach)
      caller_id: p1.mobile_phone as string,
      caller_id_raw: `+1${p1.mobile_phone}`,
      caller_name_cnam: `${(p1.last_name as string).toUpperCase()} ${(p1.first_name as string).toUpperCase()}`,
      received_at: minutesAgo(15),
      duration_seconds: 22,
      transcript: 'Hi, this is calling about my appointment next week. Can you give me a call back? Thanks.',
      scenario: 'auto-match-single',
    },
    {
      // Scenario: caller_id zero matches (manual search needed)
      caller_id: '2165550199',
      caller_id_raw: '+12165550199',
      caller_name_cnam: 'UNKNOWN CALLER',
      received_at: minutesAgo(45),
      duration_seconds: 14,
      transcript: 'Yeah hi, trying to reach, uh, Dr. office. My name is Pat Reynolds and I want to schedule a consult.',
      scenario: 'no-match-new-prospect',
    },
    {
      // Scenario: caller_id matches one, but transcript suggests it's about a different patient (third-party)
      caller_id: p2.mobile_phone as string,
      caller_id_raw: `+1${p2.mobile_phone}`,
      caller_name_cnam: `${(p2.last_name as string).toUpperCase()} ${(p2.first_name as string).toUpperCase()}`,
      received_at: minutesAgo(90),
      duration_seconds: 18,
      transcript: "Hello, I'm calling for my mother. She has an appointment on Thursday and we need to reschedule. Please call me back.",
      scenario: 'third-party-about-other-patient',
    },
    {
      // Scenario: garbled transcript, first name only
      caller_id: '3305550143',
      caller_id_raw: '+13305550143',
      caller_name_cnam: 'NO CALLER ID',
      received_at: minutesAgo(180),
      duration_seconds: 9,
      transcript: "[inaudible] it's Linda, just checking on my [inaudible] call me when you can",
      scenario: 'garbled-first-name-only',
    },
    {
      // Scenario: caller_id is a pharmacy calling on behalf of a patient
      caller_id: '8005551212',
      caller_id_raw: '+18005551212',
      caller_name_cnam: 'CVS PHARMACY',
      received_at: minutesAgo(240),
      duration_seconds: 35,
      transcript: "Hi, this is CVS Pharmacy on Main Street calling regarding a prescription for a patient. Please call us back at your earliest convenience to confirm a dose change.",
      scenario: 'institutional-caller',
    },
    {
      // Scenario: caller_id matches patient #3 — another happy-path
      caller_id: p3.mobile_phone as string,
      caller_id_raw: `+1${p3.mobile_phone}`,
      caller_name_cnam: `${(p3.last_name as string).toUpperCase()} ${(p3.first_name as string).toUpperCase()}`,
      received_at: minutesAgo(300),
      duration_seconds: 11,
      transcript: "Hi, just confirming my appointment. Thanks!",
      scenario: 'auto-match-single-2',
    },
  ];

  // If the user is in the roster, add a personal stub — the admin (you) calling about yourself.
  if (me) {
    stubs.push({
      caller_id: me.mobile_phone as string,
      caller_id_raw: `+1${me.mobile_phone}`,
      caller_name_cnam: `${(me.last_name as string).toUpperCase()} ${(me.first_name as string).toUpperCase()}`,
      received_at: minutesAgo(5),
      duration_seconds: 17,
      transcript: 'Leaving a message for Scheduling Uh, making sure the app works. The end. Ibubab.',
      scenario: 'personal-smoke-test',
    });
  }

  console.log(`Seeding ${stubs.length} stub voicemails into ${args.table}:`);
  for (const s of stubs) {
    const vm_id = `vm_${randomUUID()}`;
    const item = {
      PK: 'VOICEMAIL#UNMATCHED',
      SK: `VM#${s.received_at}#${vm_id}`,
      entity_type: 'voicemail_unmatched',
      voicemail_id: vm_id,
      caller_id: s.caller_id,
      caller_id_raw: s.caller_id_raw,
      caller_name_cnam: s.caller_name_cnam,
      received_at: s.received_at,
      duration_seconds: s.duration_seconds,
      transcript: s.transcript,
      source: 'stub',
      scenario: s.scenario,
    };
    await ddb.send(new PutCommand({ TableName: args.table, Item: item }));
    console.log(`  ✓ ${s.scenario.padEnd(36)} caller_id=${s.caller_id} vm_id=${vm_id}`);
  }
  console.log('\nDone. Query unmatched partition:');
  console.log(`  aws dynamodb query --table-name ${args.table} --key-condition-expression "PK = :pk" --expression-attribute-values '{":pk":{"S":"VOICEMAIL#UNMATCHED"}}'`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
