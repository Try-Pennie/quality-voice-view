import assert from 'node:assert/strict';
import { compareMigrations, fingerprint, parseLedger, readDatabase } from './release-preflight.mjs';

const local = [{ version: '20260920200000', name: 'protect_manager_role_on_insert', hash: fingerprint('select 1;') }];
assert.deepEqual(compareMigrations(local, [...local]), []);
const timestampDrift = compareMigrations(local, [{ ...local[0], version: '20260920210000' }]);
assert.deepEqual(timestampDrift.map((row) => row.kind), ['local-only', 'remote-only']);
assert.equal(timestampDrift[0].candidates[0].sameBody, true);
assert.equal(compareMigrations(local, [{ ...local[0], hash: fingerprint('select 2;') }])[0].kind, 'body-mismatch');
assert.equal(compareMigrations([...local, ...local], local)[0].kind, 'duplicate-local-version');
assert.equal(compareMigrations(local, [...local, ...local])[0].kind, 'duplicate-remote-version');
assert.equal(compareMigrations(local, [])[0].kind, 'local-only');
assert.equal(fingerprint('select 1;\r\n'), fingerprint('select 1;\n'));
assert.throws(() => parseLedger({ error: 'not a ledger' }));
assert.throws(() => parseLedger([{ version: 'bad', name: 'bad', body: '' }]));
assert.deepEqual(parseLedger([{ version: local[0].version, name: local[0].name, body: 'select 1;' }]), local);

const requests = [];
const transport = async (url, options) => {
  requests.push({ url, options });
  return new Response(JSON.stringify([{ version: local[0].version, name: local[0].name, body: 'select 1;' }]), { status: 200 });
};
const result = await readDatabase('xuvveqaizlletsqvwpgx', 'test-only-token', 'select 1', transport);
assert.deepEqual(parseLedger(result), local);
assert.equal(requests.length, 1);
assert.equal(requests[0].url, 'https://api.supabase.com/v1/projects/xuvveqaizlletsqvwpgx/database/query/read-only');
assert.deepEqual(JSON.parse(requests[0].options.body), { query: 'select 1' });
await assert.rejects(readDatabase('unknown', 'token', 'select 1', transport));
await assert.rejects(readDatabase('xuvveqaizlletsqvwpgx', '', 'select 1', transport));
assert.equal(requests.length, 1, 'invalid target/auth must fail before any request');
await assert.rejects(readDatabase('xuvveqaizlletsqvwpgx', 'token', 'select 1', async () => new Response('private secret', { status: 403 })), (error) => !error.message.includes('private secret') && error.message.includes('403'));
console.log('PASS: read-only preflight detects missing, aliased, mismatched, duplicate and malformed migrations without leaking response bodies');
