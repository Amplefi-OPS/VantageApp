/**
 * GET /zoom/voicemails?from=...&to=...
 *
 * Fetches voicemails from Zoom Phone API — user-level, call queues,
 * common areas, and other phone users. Auto-matches voicemails to
 * patients by phone number and creates todo tasks automatically.
 *
 * Query params:
 *   from  (optional) - ISO date, e.g. 2026-03-01
 *   to    (optional) - ISO date, e.g. 2026-03-02
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getCallerIdentity } from '../shared/auth';
import { putItem, updateItem, buildUpdateExpression, queryItems, writeAuditLog } from '../shared/dynamo';
import { zoomGet, zoomDownload } from '../shared/zoom';
import { success, serverError } from '../shared/response';
import { getSecrets } from '../shared/secrets';

const s3 = new S3Client({});
const AUDIO_BUCKET = process.env.AUDIO_BUCKET!;
const KMS_KEY_ARN = process.env.KMS_KEY_ARN!;
const PRESIGN_EXPIRY = parseInt(process.env.PRESIGN_EXPIRY_SECONDS || '900', 10);

// ── Zoom API types ──

interface ZoomVoicemail {
  id: string;
  caller_number: string;
  caller_name: string;
  callee_number: string;
  callee_name: string;
  date_time: string;
  duration: number;
  download_url: string;
  status: 'read' | 'unread';
  call_id: string;
  call_log_id: string;
}

interface ZoomVoicemailResponse {
  voice_mails: ZoomVoicemail[];
  total_records: number;
  page_size: number;
  next_page_token: string;
}

interface ZoomCallQueue {
  id: string;
  name: string;
  extension_number: string;
  status: string;
}

interface ZoomCallQueueListResponse {
  call_queues: ZoomCallQueue[];
  total_records: number;
  page_size: number;
  next_page_token: string;
}

interface ZoomCommonArea {
  id: string;
  display_name: string;
}

interface ZoomCommonAreaListResponse {
  common_areas: ZoomCommonArea[];
  total_records: number;
  page_size: number;
  next_page_token: string;
}

// ── IVR category mapping ──

// Map auto receptionist / callee name → voicemail category
const CALLEE_NAME_TO_CATEGORY: Record<string, string> = {
  'scheduling': 'Scheduling',
  'refill': 'Refills',
  'billing': 'Billing',
  'new patient': 'New Patient',
  'all other': 'Everything Else',
  'vr phone system': 'Everything Else',
};

// Fallback: extension number → category
const EXTENSION_TO_CATEGORY: Record<string, string> = {
  '540': 'Scheduling',
  '542': 'Refills',
  '543': 'Billing',
  '545': 'New Patient',
  '544': 'Everything Else',
};

// Category → todo task type
const CATEGORY_TO_TODO_TYPE: Record<string, string> = {
  'Scheduling': 'Schedule',
  'Refills': 'Refill',
  'Billing': 'General',
  'New Patient': 'CallBack',
  'Everything Else': 'CallBack',
};

function resolveCategory(calleeName: string, calleeNumber: string): string {
  console.log(`resolveCategory input: calleeName="${calleeName}", calleeNumber="${calleeNumber}"`);
  if (calleeName) {
    const key = calleeName.toLowerCase().trim();
    // Check for partial matches (e.g., "Scheduling - Ext. 540")
    for (const [pattern, category] of Object.entries(CALLEE_NAME_TO_CATEGORY)) {
      if (key.includes(pattern)) {
        console.log(`  Matched callee name pattern "${pattern}" → "${category}"`);
        return category;
      }
    }
    console.log(`  No callee name match for "${key}"`);
  }
  if (calleeNumber) {
    const digits = calleeNumber.replace(/\D/g, '');
    console.log(`  Trying extension digits: full="${digits}", last3="${digits.slice(-3)}", last4="${digits.slice(-4)}"`);
    // Try exact match first (e.g., "540")
    if (EXTENSION_TO_CATEGORY[digits]) return EXTENSION_TO_CATEGORY[digits];
    // Try last 3 digits (Zoom may return full DID like "+18005550540")
    const last3 = digits.slice(-3);
    if (EXTENSION_TO_CATEGORY[last3]) return EXTENSION_TO_CATEGORY[last3];
    // Try last 4 digits
    const last4 = digits.slice(-4);
    if (EXTENSION_TO_CATEGORY[last4]) return EXTENSION_TO_CATEGORY[last4];
  }
  console.log(`  → defaulting to Everything Else`);
  return 'Everything Else';
}

// ── Phone number normalization ──

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return ''; // require full 10-digit number
  return digits.slice(-10);
}

// ── S3 audio caching ──

/** Check if audio already exists in S3 */
async function audioExistsInS3(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: AUDIO_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Download voicemail audio from Zoom and store in S3, return presigned URL */
async function getAudioUrl(vmId: string, zoomDownloadUrl: string, providerId: string): Promise<string> {
  const s3Key = `voicemails/${providerId}/${vmId}.mp3`;

  // Check if already cached in S3
  const exists = await audioExistsInS3(s3Key);

  if (!exists) {
    try {
      const { buffer, contentType } = await zoomDownload(zoomDownloadUrl);
      await s3.send(new PutObjectCommand({
        Bucket: AUDIO_BUCKET,
        Key: s3Key,
        Body: buffer,
        ContentType: contentType,
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: KMS_KEY_ARN,
      }));
      console.log(`Cached voicemail audio in S3: ${s3Key} (${buffer.length} bytes)`);
    } catch (err) {
      console.warn(`Failed to cache voicemail ${vmId} audio:`, (err as Error).message);
      // Return Zoom URL as fallback (won't play but doesn't break)
      return zoomDownloadUrl;
    }
  }

  // Generate presigned GET URL
  try {
    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: s3Key,
    }), { expiresIn: PRESIGN_EXPIRY });
    return url;
  } catch (err) {
    console.error(`Failed to generate presigned URL for ${s3Key}:`, (err as Error).message);
    return zoomDownloadUrl;
  }
}

// ── Handler ──

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const providerId = caller.providerId;
    const params = event.queryStringParameters || {};

    const zoomParams: Record<string, string> = {
      page_size: '100',
    };
    if (params.from) zoomParams.from = params.from;
    if (params.to) zoomParams.to = params.to;

    const allVoicemails: ZoomVoicemail[] = [];

    // 1. Try account-level voicemail endpoint (works with phone:read:list_voicemails:admin)
    let accountLevelWorked = false;
    try {
      const accountVm = await zoomGet<ZoomVoicemailResponse>(
        '/phone/voice_mails',
        zoomParams,
      );
      if (accountVm.voice_mails?.length) {
        console.log(`Account-level voicemails found: ${accountVm.voice_mails.length}`);
        allVoicemails.push(...accountVm.voice_mails);
        accountLevelWorked = true;
      } else {
        console.log('Account-level voicemails endpoint returned 0 results');
      }
    } catch (err) {
      console.warn('Account-level voicemails failed:', (err as Error).message);
    }

    // 2. Fetch user-level voicemails
    const secrets = await getSecrets();
    const zoomUser = secrets.ZOOM_USER_EMAIL || 'me';
    try {
      const userData = await zoomGet<ZoomVoicemailResponse>(
        `/phone/users/${encodeURIComponent(zoomUser)}/voice_mails`,
        zoomParams,
      );
      if (userData.voice_mails?.length) {
        console.log(`User voicemails found: ${userData.voice_mails.length}`);
        allVoicemails.push(...userData.voice_mails);
      }
    } catch (err) {
      console.warn('User voicemails fetch failed:', (err as Error).message);
    }

    // 3. Fetch voicemails from hardcoded auto receptionist IDs (env var fallback)
    //    Set ZOOM_AUTO_RECEPTIONIST_IDS=id1,id2,id3 to bypass listing
    const hardcodedArIds = (secrets.ZOOM_AUTO_RECEPTIONIST_IDS || '').split(',').filter(Boolean);
    if (hardcodedArIds.length > 0) {
      console.log(`Trying ${hardcodedArIds.length} hardcoded auto receptionist IDs`);
      for (const arId of hardcodedArIds) {
        try {
          const arVm = await zoomGet<ZoomVoicemailResponse>(
            `/phone/auto_receptionists/${arId.trim()}/voice_mails`,
            zoomParams,
          );
          if (arVm.voice_mails?.length) {
            console.log(`Found ${arVm.voice_mails.length} voicemails in auto receptionist ${arId}`);
            allVoicemails.push(...arVm.voice_mails);
          }
        } catch (err) {
          console.warn(`Auto receptionist ${arId} voicemails failed:`, (err as Error).message);
        }
      }
    }

    // 4. Try listing auto receptionists dynamically (needs phone:read:list_auto_receptionists:admin)
    if (hardcodedArIds.length === 0) {
      try {
        const arResp = await zoomGet<{ auto_receptionists: { id: string; name: string; extension_number: string }[]; total_records: number }>(
          '/phone/auto_receptionists',
          { page_size: '100' },
        );
        const autoRecs = arResp.auto_receptionists || [];
        console.log('Auto receptionists found:', arResp.total_records, autoRecs.map((ar) => `${ar.name} (ext ${ar.extension_number})`));

        for (const ar of autoRecs) {
          try {
            const arVm = await zoomGet<ZoomVoicemailResponse>(
              `/phone/auto_receptionists/${ar.id}/voice_mails`,
              zoomParams,
            );
            if (arVm.voice_mails?.length) {
              console.log(`Found ${arVm.voice_mails.length} voicemails in auto receptionist "${ar.name}"`);
              allVoicemails.push(...arVm.voice_mails);
            }
          } catch (err) {
            console.warn(`Auto receptionist "${ar.name}" voicemails failed:`, (err as Error).message);
          }
        }
      } catch (err) {
        console.warn('Auto receptionists list failed:', (err as Error).message);
      }
    }

    // 5. Try listing call queues (needs phone:read:list_call_queues:admin)
    try {
      const queues = await zoomGet<ZoomCallQueueListResponse>(
        '/phone/call_queues',
        { page_size: '100' },
      );
      console.log('Call queues found:', queues.total_records, (queues.call_queues || []).map((q) => q.name));

      for (const queue of queues.call_queues || []) {
        try {
          const queueVm = await zoomGet<ZoomVoicemailResponse>(
            `/phone/call_queues/${queue.id}/voice_mails`,
            zoomParams,
          );
          if (queueVm.voice_mails?.length) {
            console.log(`Found ${queueVm.voice_mails.length} voicemails in queue "${queue.name}"`);
            allVoicemails.push(...queueVm.voice_mails);
          }
        } catch (err) {
          console.warn(`Queue "${queue.name}" voicemails failed:`, (err as Error).message);
        }
      }
    } catch (err) {
      console.warn('Call queues list failed:', (err as Error).message);
    }

    // 6. Try listing common areas (needs phone:read:common_area:admin)
    try {
      const areas = await zoomGet<ZoomCommonAreaListResponse>(
        '/phone/common_areas',
        { page_size: '100' },
      );
      console.log('Common areas found:', areas.total_records);

      for (const area of areas.common_areas || []) {
        try {
          const areaVm = await zoomGet<ZoomVoicemailResponse>(
            `/phone/common_areas/${area.id}/voice_mails`,
            zoomParams,
          );
          if (areaVm.voice_mails?.length) {
            console.log(`Found ${areaVm.voice_mails.length} voicemails in common area "${area.display_name}"`);
            allVoicemails.push(...areaVm.voice_mails);
          }
        } catch (err) {
          console.warn(`Common area "${area.display_name}" voicemails failed:`, (err as Error).message);
        }
      }
    } catch (err) {
      console.warn('Common areas list failed:', (err as Error).message);
    }

    // 7. List other phone users (needs phone:read:list_users:admin)
    try {
      const phoneUsers = await zoomGet<{ users: { id: string; email: string; name: string }[]; total_records: number }>(
        '/phone/users',
        { page_size: '50' },
      );
      console.log('Phone users found:', phoneUsers.total_records);

      for (const user of phoneUsers.users || []) {
        if (user.email === zoomUser) continue;
        try {
          const userVm = await zoomGet<ZoomVoicemailResponse>(
            `/phone/users/${encodeURIComponent(user.email)}/voice_mails`,
            zoomParams,
          );
          if (userVm.voice_mails?.length) {
            console.log(`Found ${userVm.voice_mails.length} voicemails for ${user.email}`);
            allVoicemails.push(...userVm.voice_mails);
          }
        } catch (err) {
          console.warn(`Voicemails for ${user.email} failed:`, (err as Error).message);
        }
      }
    } catch (err) {
      console.warn('Phone users list failed:', (err as Error).message);
    }

    console.log(`Total voicemails collected (before dedup): ${allVoicemails.length}, accountLevelWorked: ${accountLevelWorked}`);

    // Deduplicate by voicemail ID
    const seen = new Set<string>();
    const uniqueVoicemails = allVoicemails.filter((vm) => {
      if (seen.has(vm.id)) return false;
      seen.add(vm.id);
      return true;
    });

    // ── Look up existing voicemail attachments in DynamoDB ──
    const attachments = await queryItems({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROVIDER#${providerId}`,
        ':sk': 'VOICEMAIL#',
      },
    });

    const attachMap = new Map<string, { type: string; patientId?: string; category?: string; status?: string; transcript?: string; transcriptStatus?: string; suggestedPatientIds?: string[] }>();
    for (const item of attachments) {
      attachMap.set(item.voicemailId as string, {
        type: item.attachmentType as string,
        patientId: item.patientId as string | undefined,
        category: item.category as string | undefined,
        status: item.status as string | undefined,
        transcript: item.transcript as string | undefined,
        transcriptStatus: item.transcriptStatus as string | undefined,
        suggestedPatientIds: item.suggestedPatientIds as string[] | undefined,
      });
    }

    // ── Load patients for phone number matching ──
    const patientItems = await queryItems({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `PROVIDER#${providerId}`,
        ':sk': 'PATIENT#',
      },
    });

    // Build phone → patient lookup (normalized, 10-digit match only)
    const phoneToPatient = new Map<string, { id: string; firstName: string; lastName: string }>();
    for (const p of patientItems) {
      const phone = normalizePhone((p.phone as string) || '');
      if (phone && phone.length === 10) {
        phoneToPatient.set(phone, {
          id: p.patientId as string,
          firstName: p.firstName as string,
          lastName: p.lastName as string,
        });
      }
    }

    // ── Auto-attach new voicemails and create todos ──
    const now = new Date().toISOString();
    for (const vm of uniqueVoicemails) {
      if (attachMap.has(vm.id)) continue; // already processed

      const callerPhone = normalizePhone(vm.caller_number || '');
      const matchedPatient = callerPhone ? phoneToPatient.get(callerPhone) : undefined;
      const category = resolveCategory(vm.callee_name || '', vm.callee_number || '');
      console.log(`New VM ${vm.id}: callee_name="${vm.callee_name}", callee_number="${vm.callee_number}" → category="${category}"`);

      // Write voicemail attachment record
      const vmRecord: Record<string, unknown> = {
        PK: `PROVIDER#${providerId}`,
        SK: `VOICEMAIL#${vm.id}`,
        voicemailId: vm.id,
        providerId,
        patientId: matchedPatient?.id || null,
        attachmentType: matchedPatient ? 'patient' : 'none',
        callerNumber: vm.caller_number || 'Unknown',
        callerName: vm.caller_name || null,
        calleeName: vm.callee_name || null,
        calleeNumber: vm.callee_number || null,
        category,
        status: matchedPatient ? 'Attached' : 'Unattached',
        receivedAt: vm.date_time,
        durationSeconds: vm.duration,
        audioUrl: vm.download_url,
        transcriptStatus: 'Pending',
        createdAt: now,
        GSI1PK: `PROVIDER#${providerId}`,
        GSI1SK: `VOICEMAIL#${vm.date_time}`,
        entityType: 'VoicemailAttachment',
      };

      try {
        await putItem(vmRecord);
      } catch (err) {
        console.warn(`Failed to write voicemail record ${vm.id}:`, (err as Error).message);
        continue;
      }

      // Update local cache
      attachMap.set(vm.id, {
        type: matchedPatient ? 'patient' : 'none',
        patientId: matchedPatient?.id,
        category,
      });

      // Auto-create todo task for every voicemail
      const taskId = `task-${randomUUID().slice(0, 12)}`;
      const todoType = CATEGORY_TO_TODO_TYPE[category] || 'CallBack';
      const patientLabel = matchedPatient
        ? `${matchedPatient.firstName} ${matchedPatient.lastName}`
        : 'New Patient';
      const title = `${patientLabel} — ${category}`;

      const taskRecord = {
        PK: `PROVIDER#${providerId}`,
        SK: `TASK#${taskId}`,
        taskId,
        providerId,
        patientId: matchedPatient?.id || null,
        voicemailId: vm.id,
        type: todoType,
        title,
        status: 'Open',
        priority: 'Med',
        dueDate: null,
        assignedTo: null,
        notes: `Auto-created from voicemail. Caller: ${vm.caller_name || vm.caller_number || 'Unknown'}. Duration: ${vm.duration}s.`,
        dictationId: null,
        createdAt: now,
        updatedAt: now,
        GSI1PK: `PROVIDER#${providerId}`,
        GSI1SK: `TASKSTATUS#Open#${now}`,
        GSI2PK: 'TASK',
        GSI2SK: `${now}#${taskId}`,
        entityType: 'Task',
      };

      try {
        await putItem(taskRecord);
        await writeAuditLog({
          providerId,
          action: 'AUTO_CREATE_TASK',
          entityType: 'Task',
          entityId: taskId,
          details: { voicemailId: vm.id, category, todoType, patientId: matchedPatient?.id || null },
        });
        console.log(`Auto-created task ${taskId} for voicemail ${vm.id} → ${patientLabel}`);
      } catch (err) {
        console.warn(`Failed to create task for voicemail ${vm.id}:`, (err as Error).message);
      }
    }

    // ── Cache audio in S3 and generate presigned URLs ──
    const audioUrlPromises = uniqueVoicemails.map((vm) =>
      getAudioUrl(vm.id, vm.download_url, providerId),
    );
    const audioUrls = await Promise.all(audioUrlPromises);

    // ── Re-resolve categories and re-match unattached voicemails to patients ──
    const updatePromises: Promise<void>[] = [];
    for (const vm of uniqueVoicemails) {
      const attachment = attachMap.get(vm.id);
      if (!attachment) continue;

      const updates: Record<string, unknown> = {};

      // Re-resolve category from fresh Zoom data
      const freshCategory = resolveCategory(vm.callee_name || '', vm.callee_number || '');
      if (freshCategory !== attachment.category) {
        console.log(`Re-categorizing VM ${vm.id}: "${attachment.category}" → "${freshCategory}"`);
        updates.category = freshCategory;
        updates.calleeName = vm.callee_name || null;
        updates.calleeNumber = vm.callee_number || null;
        attachment.category = freshCategory;
      }

      // Re-match unattached voicemails to patients by phone
      if (attachment.type === 'none' && !attachment.patientId) {
        const callerPhone = normalizePhone(vm.caller_number || '');
        const matched = callerPhone ? phoneToPatient.get(callerPhone) : undefined;
        if (matched) {
          console.log(`Late-matching VM ${vm.id} → patient ${matched.id} (${matched.firstName} ${matched.lastName})`);
          updates.patientId = matched.id;
          updates.attachmentType = 'patient';
          updates.status = 'Attached';
          attachment.type = 'patient';
          attachment.patientId = matched.id;
        }
      }

      if (Object.keys(updates).length > 0) {
        const expr = buildUpdateExpression(updates);
        if (expr) {
          updatePromises.push(
            updateItem({
              Key: { PK: `PROVIDER#${providerId}`, SK: `VOICEMAIL#${vm.id}` },
              ...expr,
            }).then(() => undefined).catch((err) => console.warn(`Failed to update VM ${vm.id}:`, (err as Error).message))
          );
        }
      }
    }
    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
    }

    // ── Map to frontend shape ──
    const voicemails = uniqueVoicemails.map((vm, i) => {
      const attachment = attachMap.get(vm.id);
      // Always resolve from fresh Zoom data
      const category = resolveCategory(vm.callee_name || '', vm.callee_number || '');

      return {
        id: vm.id,
        callerNumber: vm.caller_number || 'Unknown',
        callerName: vm.caller_name || undefined,
        receivedAt: vm.date_time,
        category,
        durationSeconds: vm.duration,
        audioUrl: audioUrls[i],
        attachedTo: attachment && attachment.type !== 'none'
          ? { type: attachment.type, patientId: attachment.patientId }
          : { type: 'none' },
        status: attachment?.status === 'Archived' ? 'Archived'
          : attachment && attachment.type !== 'none' ? 'Attached' : 'Unattached',
        transcript: attachment?.transcript || undefined,
        transcriptStatus: attachment?.transcriptStatus || undefined,
        suggestedPatientIds: attachment?.suggestedPatientIds || undefined,
      };
    });

    // Sort newest first
    voicemails.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

    return success(voicemails);
  } catch (err) {
    console.error('List Zoom voicemails error:', (err as Error).message);
    return serverError('Failed to retrieve voicemails from Zoom');
  }
};
