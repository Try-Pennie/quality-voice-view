// Run: node docs/integrations/achieve-pipedream-parser.check.js
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pipedreamComponent, {
  EXPECTED_HEADER,
  chunk,
  extractSnowflakeRows,
  parseCsv,
  planBridgeRows,
  planRows,
  reportDateFromName,
} from "./achieve-pipedream-parser.js";

const csv = [
  "client_id,welcome_call_agent_name,welcome_call_agent_email",
  'AFFQB000000000000001,"Doe, Jane",JANE@ACHIEVE.COM',
  'affqb000000000000001,"Doe, Janet",jane@achieve.com',
  "AFFQB000000000000002,John Smith,john@achieve.com",
].join("\n");

const parsed = parseCsv(csv);
assert.equal(parsed[1][1], "Doe, Jane");
assert.equal(reportDateFromName("ws_rpt_Pennie_welcome_call_agents_20260811.csv"), "2026-08-11");

const agentPlan = planRows(parsed, "2026-08-11");
assert.equal(agentPlan.blocked, null);
assert.equal(agentPlan.records.length, 2);
assert.equal(agentPlan.records[0].welcome_call_agent_name, "Doe, Janet");
assert.equal(agentPlan.records[0].welcome_call_agent_email, "jane@achieve.com");
assert.ok(agentPlan.anomalies.some((item) => item.type === "same_pairing_name_conflict_in_file"));
const anomalyJson = JSON.stringify(agentPlan.anomalies);
assert.ok(!anomalyJson.includes("AFFQB000000000000001"));
assert.ok(!anomalyJson.includes("jane@achieve.com"));
assert.ok(!anomalyJson.includes("Doe, Janet"));

const emptyPlan = planRows([EXPECTED_HEADER], "2026-08-11");
assert.match(emptyPlan.blocked, /no valid client\/agent rows/);

const snowflakeRows = [
  {
    sfdc_lead_id: "00Q000000000000001",
    client_id: "affqb000000000000001",
    source_last_modified_at: "2026-08-11T12:00:00Z",
  },
  {
    SFDC_LEAD_ID: "00Q000000000000002",
    CLIENT_ID: "AFFQB000000000000002",
    SOURCE_LAST_MODIFIED_AT: "2026-08-11T12:05:00Z",
  },
];
assert.deepEqual(extractSnowflakeRows({ rows: snowflakeRows }), snowflakeRows);

const syncedAt = "2026-08-11T13:00:00.000Z";
const bridgePlan = planBridgeRows(snowflakeRows, agentPlan.records, syncedAt);
assert.equal(bridgePlan.blocked, null);
assert.equal(bridgePlan.records.length, 2);
assert.equal(bridgePlan.stats.coverage, 1);
assert.equal(bridgePlan.records[0].synced_at, syncedAt);
assert.equal(bridgePlan.records[0].source_last_modified_at, "2026-08-11T12:00:00.000Z");

const lowCoverage = planBridgeRows(
  snowflakeRows.slice(0, 1),
  Array.from({ length: 20 }, (_, index) => ({
    client_id: `AFFQB${String(index).padStart(15, "0")}`,
  })),
  syncedAt,
);
assert.match(lowCoverage.blocked, /minimum is 90%/);

assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.throws(() => extractSnowflakeRows({ unexpected: [] }), /did not return a row array/);

// Exercise the component's real run seam with fake HTTP/runtime adapters. This
// verifies write order, successful state marking, and partial-failure replay.
async function runComponent({ bridgeFails }) {
  const calls = [];
  const exports = new Map();
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const serviceAccount = {
    client_email: "service@example.invalid",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
  const csvBody = [
    EXPECTED_HEADER.join(","),
    "AFFQB000000000000001,Representative One,one@example.invalid",
    "AFFQB000000000000002,Representative Two,two@example.invalid",
  ].join("\n");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      calls.push("oauth");
      return Response.json({ access_token: "test-token" });
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) {
      calls.push("drive-list");
      return Response.json({
        files: [{
          id: "drive-file-1",
          name: "ws_rpt_Pennie_welcome_call_agents_20260811.csv",
          mimeType: "text/csv",
          createdTime: "2026-08-11T11:00:00Z",
          modifiedTime: "2026-08-11T11:00:00Z",
        }],
      });
    }
    if (url.includes("/drive/v3/files/drive-file-1?alt=media")) {
      calls.push("drive-download");
      return new Response(csvBody);
    }
    if (init.method === "HEAD" && url.includes("/rest/v1/")) {
      calls.push(url.includes("achieve_client_sfdc_map") ? "bridge-count" : "agent-count");
      return new Response(null, {
        status: 200,
        headers: { "content-range": "0-0/10" },
      });
    }
    if (url.includes("/rest/v1/rpc/ingest_welcome_call_agents")) {
      calls.push("agent-write");
      return Response.json({ inserted: 2, updated: 0, unchanged: 0 });
    }
    if (url.includes("/rest/v1/achieve_client_sfdc_map")) {
      calls.push("bridge-write");
      if (bridgeFails) return new Response("synthetic failure", { status: 500 });
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch: ${init.method ?? "GET"} ${url}`);
  };

  const context = {
    db: {
      async get() { return null; },
      async set(key, value) { calls.push("state-set"); this.saved = { key, value }; },
    },
    gdriveSaJson: JSON.stringify(serviceAccount),
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "test-service-role-key",
    reviewWebhookUrl: "",
    dryRun: false,
    forceReprocess: true,
  };
  const runtime = {
    export(key, value) { exports.set(key, value); },
  };
  const steps = {
    fetch_achieve_client_sfdc_map: {
      $return_value: snowflakeRows,
    },
  };

  try {
    const result = await pipedreamComponent.run.call(context, { $: runtime, steps });
    return { calls, exports, result, error: null };
  } catch (error) {
    return { calls, exports, result: null, error };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const successfulRun = await runComponent({ bridgeFails: false });
assert.equal(successfulRun.error, null);
assert.ok(successfulRun.calls.indexOf("agent-write") < successfulRun.calls.indexOf("bridge-write"));
assert.ok(successfulRun.calls.indexOf("bridge-write") < successfulRun.calls.indexOf("state-set"));
assert.equal(successfulRun.result.bridgeResult.upserted, 2);
assert.ok(!JSON.stringify(successfulRun.exports.get("report")).includes("AFFQB000000000000001"));
assert.ok(!JSON.stringify(successfulRun.exports.get("report")).includes("one@example.invalid"));

const partialFailure = await runComponent({ bridgeFails: true });
assert.match(partialFailure.error.message, /Supabase write failed/);
assert.ok(partialFailure.calls.includes("agent-write"));
assert.ok(partialFailure.calls.includes("bridge-write"));
assert.ok(!partialFailure.calls.includes("state-set"));
assert.ok(partialFailure.exports.has("report"));

console.log("achieve-pipedream-parser.check.js: all assertions passed");
