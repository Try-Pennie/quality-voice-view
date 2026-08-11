// ============================================================
// Welcome-Call Agents ingest — Pipedream code step
//
// Daily workflow:
//   1. Snowflake "Execute Query" step (key: fetch_achieve_client_sfdc_map)
//      returns the Salesforce Lead ID -> Achieve client ID bridge.
//   2. This step downloads the newest Achieve welcome-call-agent report from
//      Drive and upserts both datasets into Supabase.
//
// Supabase destinations:
//   - welcome_call_agent_log via ingest_welcome_call_agents RPC
//   - achieve_client_sfdc_map via idempotent PostgREST upsert
//
// Credentials remain in their owning integrations: Pipedream owns Snowflake,
// while this step receives Google service-account and Supabase service-role
// credentials as secret props. Never use the Supabase anon key here.
// ============================================================

import crypto from "node:crypto";

const DRIVE_FOLDER_ID = "1WL4emmOfsf5MHFNIrG5lfjYvjaFlincD";
const FILE_NAME_MATCH = "welcome_call_agents";
const RPC_NAME = "ingest_welcome_call_agents";
const AGENT_LOG_TABLE_NAME = "welcome_call_agent_log";
const BRIDGE_TABLE_NAME = "achieve_client_sfdc_map";
const SNOWFLAKE_STEP_KEY = "fetch_achieve_client_sfdc_map";
const CHUNK_SIZE = 1000;
const DS_KEY_LAST_PROCESSED = "wca_last_processed";
const STALE_DAYS_WARN = 3;
const MIN_BRIDGE_COVERAGE = 0.9;

export const EXPECTED_HEADER = [
  "client_id",
  "welcome_call_agent_name",
  "welcome_call_agent_email",
];

// ------------------------------------------------------------
// Pure helpers (exported for the offline harness)
// ------------------------------------------------------------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

export function reportDateFromName(name) {
  const matches = String(name).match(/(20\d{2})(\d{2})(\d{2})(?!\d)/g);
  if (!matches) return null;
  const last = matches[matches.length - 1];
  const iso = `${last.slice(0, 4)}-${last.slice(4, 6)}-${last.slice(6, 8)}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function cappedSamples(values, n = 10) {
  return values.length > n
    ? [...values.slice(0, n), `…and ${values.length - n} more`]
    : values;
}

function normalizedClientId(value) {
  return String(value ?? "").trim().toLowerCase();
}

function safeOperationalMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bAFF[A-Za-z0-9]{17}\b/gi, "[achieve-client-id]")
    .replace(/\b00Q[A-Za-z0-9]{15}\b/g, "[salesforce-lead-id]")
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, "[email]")
    .slice(0, 1000);
}

// Parse + validate + dedupe the file into RPC-ready records.
// blocked (string) => the load must NOT run.
export function planRows(csvRows, reportDate) {
  const anomalies = [];
  const header = (csvRows[0] || []).map((h) => h.trim().toLowerCase());
  const missing = EXPECTED_HEADER.filter((h) => !header.includes(h));
  if (missing.length) {
    return {
      blocked: `Header mismatch — missing column(s): ${missing.join(", ")}; got: ${header.join(", ")}`,
      records: [],
      anomalies,
      stats: { fileRows: Math.max(0, csvRows.length - 1) },
    };
  }

  const extra = header.filter((h) => !EXPECTED_HEADER.includes(h));
  if (extra.length) {
    anomalies.push({
      type: "unexpected_columns",
      detail: `Extra column(s) ignored: ${extra.join(", ")}`,
    });
  }
  const idx = Object.fromEntries(
    EXPECTED_HEADER.map((h) => [h, header.indexOf(h)]),
  );

  const byKey = new Map(); // (client_id, email) -> record, keep LAST
  const emailsByClient = new Map();
  const badRows = [];
  const oddIds = [];
  const oddEmails = [];
  const nameConflicts = [];

  for (let i = 1; i < csvRows.length; i++) {
    const sourceRow = csvRows[i];
    const client_id = (sourceRow[idx.client_id] ?? "").trim();
    const name = (sourceRow[idx.welcome_call_agent_name] ?? "").trim();
    const email = (sourceRow[idx.welcome_call_agent_email] ?? "")
      .trim()
      .toLowerCase();
    if (!client_id && !name && !email) continue;
    if (!client_id || !email) {
      badRows.push(`line ${i + 1}`);
      continue;
    }
    if (client_id.length !== 20) {
      oddIds.push(`line ${i + 1}: ${client_id.length} chars`);
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      oddEmails.push(`line ${i + 1}`);
    }

    const normalizedId = normalizedClientId(client_id);
    const key = `${normalizedId}\0${email}`;
    const previous = byKey.get(key);
    if (previous && previous.welcome_call_agent_name !== name) {
      nameConflicts.push(`line ${i + 1}: duplicate pairing changed name (kept last)`);
    }
    byKey.set(key, {
      client_id,
      welcome_call_agent_name: name,
      welcome_call_agent_email: email,
      report_date: reportDate,
    });

    if (!emailsByClient.has(normalizedId)) {
      emailsByClient.set(normalizedId, new Set());
    }
    emailsByClient.get(normalizedId).add(email);
  }

  if (badRows.length) {
    anomalies.push({
      type: "rows_missing_required_fields",
      count: badRows.length,
      samples: cappedSamples(badRows),
    });
  }
  if (oddIds.length) {
    anomalies.push({
      type: "odd_client_id_length",
      count: oddIds.length,
      samples: cappedSamples(oddIds),
    });
  }
  if (oddEmails.length) {
    anomalies.push({
      type: "odd_email_format",
      count: oddEmails.length,
      samples: cappedSamples(oddEmails),
    });
  }
  if (nameConflicts.length) {
    anomalies.push({
      type: "same_pairing_name_conflict_in_file",
      count: nameConflicts.length,
      samples: cappedSamples(nameConflicts),
    });
  }

  const multiAgentClients = [...emailsByClient.entries()].filter(
    ([, emails]) => emails.size > 1,
  );
  if (multiAgentClients.length) {
    anomalies.push({
      type: "client_with_multiple_agents_in_file",
      count: multiAgentClients.length,
      samples: cappedSamples(
        multiAgentClients.map(([, emails]) => `${emails.size} agents`),
      ),
      note: "All pairings kept — this is a history table. Portal attribution stays unmatched for ambiguous clients.",
    });
  }

  const dataRows = csvRows.length - 1;
  const tolerance = Math.max(50, Math.ceil(dataRows * 0.005));
  const blocked = byKey.size === 0
    ? "Report contains no valid client/agent rows — load blocked"
    : badRows.length > tolerance
      ? `${badRows.length} rows missing client_id/email exceeds tolerance (${tolerance}) — load blocked`
      : null;

  return {
    blocked,
    records: [...byKey.values()],
    anomalies,
    stats: {
      fileRows: dataRows,
      uniquePairings: byKey.size,
      skippedBadRows: badRows.length,
    },
  };
}

function snowflakeField(row, ...names) {
  for (const name of names) {
    if (row?.[name] !== undefined && row?.[name] !== null) return row[name];
  }
  return null;
}

// Pipedream's Snowflake Execute Query action normally returns an array of row
// objects. Accept common wrappers as a defensive compatibility seam.
export function extractSnowflakeRows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.results)) return value.results;
  throw new Error(
    `Snowflake step ${SNOWFLAKE_STEP_KEY} did not return a row array`,
  );
}

// Validate and dedupe the Snowflake bridge. Coverage is measured against the
// daily Achieve report so source/schema failures block before Supabase writes.
export function planBridgeRows(rawRows, reportRecords, syncedAt) {
  const byLead = new Map();
  const anomalies = [];
  const invalidRows = [];
  const oddLeadIds = [];
  const invalidDates = [];

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const sfdcLeadId = String(
      snowflakeField(row, "sfdc_lead_id", "SFDC_LEAD_ID", "ID") ?? "",
    ).trim();
    const clientId = String(
      snowflakeField(row, "client_id", "CLIENT_ID", "CLIENT_NO_A__C") ?? "",
    ).trim();
    if (!sfdcLeadId || !clientId) {
      invalidRows.push(`row ${i + 1}`);
      continue;
    }
    if (sfdcLeadId.length !== 18) {
      oddLeadIds.push(`row ${i + 1}: ${sfdcLeadId.length} chars`);
    }

    const sourceDateRaw = snowflakeField(
      row,
      "source_last_modified_at",
      "SOURCE_LAST_MODIFIED_AT",
      "LASTMODIFIEDDATE",
    );
    let sourceLastModifiedAt = null;
    if (sourceDateRaw !== null && String(sourceDateRaw).trim()) {
      const timestamp = Date.parse(String(sourceDateRaw));
      if (Number.isNaN(timestamp)) {
        invalidDates.push(`row ${i + 1}`);
      } else {
        sourceLastModifiedAt = new Date(timestamp).toISOString();
      }
    }

    byLead.set(sfdcLeadId, {
      sfdc_lead_id: sfdcLeadId,
      client_id: clientId,
      source_last_modified_at: sourceLastModifiedAt,
      synced_at: syncedAt,
    });
  }

  if (invalidRows.length) {
    anomalies.push({
      type: "snowflake_rows_missing_ids",
      count: invalidRows.length,
      samples: cappedSamples(invalidRows),
    });
  }
  if (oddLeadIds.length) {
    anomalies.push({
      type: "odd_sfdc_lead_id_length",
      count: oddLeadIds.length,
      samples: cappedSamples(oddLeadIds),
    });
  }
  if (invalidDates.length) {
    anomalies.push({
      type: "invalid_snowflake_last_modified_at",
      count: invalidDates.length,
      samples: cappedSamples(invalidDates),
    });
  }

  const records = [...byLead.values()];
  const reportClientIds = new Set(
    reportRecords.map((record) => normalizedClientId(record.client_id)),
  );
  const mappedReportClientIds = new Set(
    records
      .map((record) => normalizedClientId(record.client_id))
      .filter((clientId) => reportClientIds.has(clientId)),
  );
  const coverage = reportClientIds.size === 0
    ? 0
    : mappedReportClientIds.size / reportClientIds.size;

  if (coverage < 1) {
    anomalies.push({
      type: "snowflake_bridge_coverage",
      mappedClients: mappedReportClientIds.size,
      reportClients: reportClientIds.size,
      coverage: Number(coverage.toFixed(4)),
    });
  }

  const invalidTolerance = Math.max(10, Math.ceil(rawRows.length * 0.005));
  let blocked = null;
  if (invalidRows.length > invalidTolerance) {
    blocked = `${invalidRows.length} invalid Snowflake bridge rows exceeds tolerance (${invalidTolerance}) — load blocked`;
  } else if (coverage < MIN_BRIDGE_COVERAGE) {
    blocked = `Snowflake bridge covers ${(coverage * 100).toFixed(1)}% of report clients; minimum is ${(MIN_BRIDGE_COVERAGE * 100).toFixed(0)}% — load blocked`;
  }

  return {
    blocked,
    records,
    anomalies,
    stats: {
      snowflakeRows: rawRows.length,
      uniqueLeadMappings: records.length,
      mappedReportClients: mappedReportClientIds.size,
      reportClients: reportClientIds.size,
      coverage: Number(coverage.toFixed(4)),
      skippedInvalidRows: invalidRows.length,
    },
  };
}

export function chunk(arr, n) {
  const output = [];
  for (let i = 0; i < arr.length; i += n) {
    output.push(arr.slice(i, i + n));
  }
  return output;
}

// ------------------------------------------------------------
// Google Drive via service account (no npm deps)
// ------------------------------------------------------------

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function saAccessToken(serviceAccount, scope) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.` +
    b64url(JSON.stringify({
      iss: serviceAccount.client_email,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }));
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(serviceAccount.private_key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${b64url(signature)}`,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `SA token exchange failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
    );
  }
  return (await response.json()).access_token;
}

async function findNewestReportFile(token) {
  const query = `'${DRIVE_FOLDER_ID}' in parents and trashed=false and name contains '${FILE_NAME_MATCH}'`;
  const files = [];
  let pageToken = null;
  do {
    const params = new URLSearchParams({
      q: query,
      fields: "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      throw new Error(
        `Drive list failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
      );
    }
    const page = await response.json();
    files.push(...(page.files || []).filter((file) =>
      file.name.toLowerCase().includes(FILE_NAME_MATCH)
    ));
    pageToken = page.nextPageToken || null;
  } while (pageToken);

  if (!files.length) {
    throw new Error(
      `No '*${FILE_NAME_MATCH}*' files found in Drive folder ${DRIVE_FOLDER_ID}`,
    );
  }
  files.sort((a, b) => {
    const dateA = reportDateFromName(a.name) || "";
    const dateB = reportDateFromName(b.name) || "";
    return dateA !== dateB
      ? (dateA < dateB ? 1 : -1)
      : (a.createdTime < b.createdTime ? 1 : -1);
  });
  return files[0];
}

async function downloadCsv(token, file) {
  const isSheet = file.mimeType === "application/vnd.google-apps.spreadsheet";
  const url = isSheet
    ? `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv`
    : `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(
      `Drive download failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
    );
  }
  return response.text();
}

// ------------------------------------------------------------
// Supabase (PostgREST, no npm deps)
// ------------------------------------------------------------

function sbHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function sbTableCount(url, key, tableName, countColumn) {
  const response = await fetch(
    `${url}/rest/v1/${tableName}?select=${encodeURIComponent(countColumn)}&limit=1`,
    {
      method: "HEAD",
      headers: { ...sbHeaders(key), Prefer: "count=exact" },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Supabase table check failed for ${tableName} (${response.status}) — has migration 20260811150000 been applied?`,
    );
  }
  const contentRange = response.headers.get("content-range") || "";
  const total = Number(contentRange.split("/")[1]);
  return Number.isFinite(total) ? total : null;
}

async function sbIngestAgentChunk(url, key, records) {
  const response = await fetch(`${url}/rest/v1/rpc/${RPC_NAME}`, {
    method: "POST",
    headers: sbHeaders(key),
    body: JSON.stringify({ rows: records }),
  });
  if (!response.ok) {
    throw new Error(
      `Supabase RPC ${RPC_NAME} failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
    );
  }
  const output = await response.json();
  const row = Array.isArray(output) ? output[0] : output;
  return {
    inserted: Number(row?.inserted ?? 0),
    updated: Number(row?.updated ?? 0),
    unchanged: Number(row?.unchanged ?? 0),
  };
}

async function sbUpsertBridgeChunk(url, key, records) {
  const response = await fetch(
    `${url}/rest/v1/${BRIDGE_TABLE_NAME}?on_conflict=sfdc_lead_id`,
    {
      method: "POST",
      headers: {
        ...sbHeaders(key),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(records),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Supabase ${BRIDGE_TABLE_NAME} upsert failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
    );
  }
}

// ------------------------------------------------------------
// Pipedream component
// ------------------------------------------------------------

const define = globalThis.defineComponent ?? ((component) => component);

export default define({
  name: "Welcome-Call Agents → Supabase",
  key: "wca-ingest-supabase",
  version: "0.2.0",
  type: "action",
  props: {
    db: { type: "data_store", label: "Data Store (file-dedupe state)" },
    gdriveSaJson: {
      type: "string",
      label: "Google service-account key JSON",
      description:
        "Paste the full service-account JSON key. The service account must have read access to the Drive folder.",
      secret: true,
    },
    supabaseUrl: {
      type: "string",
      label: "Supabase project URL",
      description: "e.g. `https://<project-ref>.supabase.co`",
    },
    supabaseServiceRoleKey: {
      type: "string",
      label: "Supabase service-role key",
      description: "Service-role key (NOT the anon key).",
      secret: true,
    },
    reviewWebhookUrl: {
      type: "string",
      label: "Review agent webhook URL",
      description: "Every run POSTs its redacted JSON report here. Leave blank to skip.",
      optional: true,
      secret: true,
    },
    dryRun: {
      type: "boolean",
      label: "Dry run (parse + plan + report only, no Supabase writes)",
      default: true,
    },
    forceReprocess: {
      type: "boolean",
      label: "Force reprocess (ignore already-processed file id)",
      default: false,
    },
  },

  async run({ $, steps }) {
    const startedAt = new Date().toISOString();
    const report = {
      job: "welcome_call_agents_ingest",
      startedAt,
      dryRun: this.dryRun,
      file: null,
      stats: {},
      dbResult: null,
      bridgeResult: null,
      anomalies: [],
      blocked: null,
      errors: [],
    };

    const finish = async (throwMessage) => {
      report.finishedAt = new Date().toISOString();
      if (this.reviewWebhookUrl) {
        try {
          await fetch(this.reviewWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(report),
          });
        } catch (error) {
          report.errors.push(`Webhook POST failed: ${safeOperationalMessage(error)}`);
        }
      }
      $.export("report", report);
      if (throwMessage) throw new Error(throwMessage);
      return report;
    };

    const serviceAccountRaw = (this.gdriveSaJson || "").trim();
    const supabaseUrl = (this.supabaseUrl || "").trim().replace(/\/+$/, "");
    const supabaseKey = (this.supabaseServiceRoleKey || "").trim();
    for (const [label, value] of [
      ["Google service-account key JSON", serviceAccountRaw],
      ["Supabase project URL", supabaseUrl],
      ["Supabase service-role key", supabaseKey],
    ]) {
      if (!value) {
        report.blocked = `Missing prop: ${label}`;
        return finish(report.blocked);
      }
    }
    if (!/^https:\/\//.test(supabaseUrl)) {
      report.blocked = `Supabase project URL should look like https://<project-ref>.supabase.co (got "${supabaseUrl}")`;
      return finish(report.blocked);
    }

    let csvText;
    let file;
    try {
      const serviceAccount = JSON.parse(serviceAccountRaw);
      const token = await saAccessToken(
        serviceAccount,
        "https://www.googleapis.com/auth/drive.readonly",
      );
      file = await findNewestReportFile(token);
      report.file = {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
      };
      csvText = await downloadCsv(token, file);
    } catch (error) {
      report.blocked = `Drive fetch failed: ${safeOperationalMessage(error)}`;
      return finish(report.blocked);
    }

    const lastProcessed = await this.db.get(DS_KEY_LAST_PROCESSED);
    if (
      lastProcessed?.fileId === file.id &&
      !this.forceReprocess &&
      !this.dryRun
    ) {
      report.stats.skipped =
        `File ${file.name} (${file.id}) already processed at ${lastProcessed.processedAt}`;
      return finish(null);
    }

    let reportDate = reportDateFromName(file.name);
    if (!reportDate) {
      reportDate = (file.modifiedTime || startedAt).slice(0, 10);
      report.anomalies.push({
        type: "no_date_in_filename",
        detail: `Using file modifiedTime date ${reportDate}`,
      });
    }
    const ageDays = Math.floor(
      (Date.parse(startedAt) - Date.parse(reportDate)) / 86400000,
    );
    if (ageDays > STALE_DAYS_WARN) {
      report.anomalies.push({
        type: "stale_file",
        detail:
          `Newest file is ${ageDays} days old (${reportDate}) — upstream export may have stopped.`,
      });
    }

    const agentPlan = planRows(parseCsv(csvText), reportDate);
    report.stats = { ...report.stats, ...agentPlan.stats, reportDate };
    report.anomalies.push(...agentPlan.anomalies);
    if (agentPlan.blocked) {
      report.blocked = agentPlan.blocked;
      return finish(agentPlan.blocked);
    }

    let bridgePlan;
    try {
      const snowflakeValue = steps?.[SNOWFLAKE_STEP_KEY]?.$return_value;
      bridgePlan = planBridgeRows(
        extractSnowflakeRows(snowflakeValue),
        agentPlan.records,
        startedAt,
      );
    } catch (error) {
      report.blocked = `Snowflake bridge planning failed: ${safeOperationalMessage(error)}`;
      return finish(report.blocked);
    }
    report.stats.bridge = bridgePlan.stats;
    report.anomalies.push(...bridgePlan.anomalies);
    if (bridgePlan.blocked) {
      report.blocked = bridgePlan.blocked;
      return finish(bridgePlan.blocked);
    }

    try {
      report.stats.agentLogRowsBefore = await sbTableCount(
        supabaseUrl,
        supabaseKey,
        AGENT_LOG_TABLE_NAME,
        "id",
      );
      report.stats.bridgeRowsBefore = await sbTableCount(
        supabaseUrl,
        supabaseKey,
        BRIDGE_TABLE_NAME,
        "sfdc_lead_id",
      );

      if (this.dryRun) {
        report.dbResult = {
          dryRun: true,
          wouldSend: agentPlan.records.length,
          chunks: chunk(agentPlan.records, CHUNK_SIZE).length,
        };
        report.bridgeResult = {
          dryRun: true,
          wouldUpsert: bridgePlan.records.length,
          chunks: chunk(bridgePlan.records, CHUNK_SIZE).length,
        };
      } else {
        const agentTotals = { inserted: 0, updated: 0, unchanged: 0 };
        for (const records of chunk(agentPlan.records, CHUNK_SIZE)) {
          const result = await sbIngestAgentChunk(
            supabaseUrl,
            supabaseKey,
            records,
          );
          agentTotals.inserted += result.inserted;
          agentTotals.updated += result.updated;
          agentTotals.unchanged += result.unchanged;
        }
        report.dbResult = agentTotals;

        const bridgeChunks = chunk(bridgePlan.records, CHUNK_SIZE);
        for (const records of bridgeChunks) {
          await sbUpsertBridgeChunk(supabaseUrl, supabaseKey, records);
        }
        report.bridgeResult = {
          upserted: bridgePlan.records.length,
          chunks: bridgeChunks.length,
        };

        report.stats.agentLogRowsAfter = await sbTableCount(
          supabaseUrl,
          supabaseKey,
          AGENT_LOG_TABLE_NAME,
          "id",
        );
        report.stats.bridgeRowsAfter = await sbTableCount(
          supabaseUrl,
          supabaseKey,
          BRIDGE_TABLE_NAME,
          "sfdc_lead_id",
        );
        await this.db.set(DS_KEY_LAST_PROCESSED, {
          fileId: file.id,
          name: file.name,
          reportDate,
          processedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      const safeMessage = safeOperationalMessage(error);
      report.errors.push(safeMessage);
      return finish(`Supabase write failed: ${safeMessage}`);
    }

    return finish(null);
  },
});
