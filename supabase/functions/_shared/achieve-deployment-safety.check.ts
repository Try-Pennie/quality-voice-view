// Run: npx tsx supabase/functions/_shared/achieve-deployment-safety.check.ts
import assert from 'node:assert/strict'
import { isAchieveExternalIoAllowed } from './achieve-deployment-safety'

const productionUrl = 'https://miikotqnovnixpeqtqnd.supabase.co'
assert.strictEqual(isAchieveExternalIoAllowed({
  deploymentEnvironment: 'production', externalIoEnabled: true, supabaseUrl: productionUrl,
}), true)
assert.strictEqual(isAchieveExternalIoAllowed({
  deploymentEnvironment: 'staging', externalIoEnabled: true, supabaseUrl: 'https://xuvveqaizlletsqvwpgx.supabase.co',
}), false)
assert.strictEqual(isAchieveExternalIoAllowed({
  deploymentEnvironment: 'production', externalIoEnabled: true, supabaseUrl: 'https://xuvveqaizlletsqvwpgx.supabase.co',
}), false)
assert.strictEqual(isAchieveExternalIoAllowed({
  deploymentEnvironment: 'production', externalIoEnabled: false, supabaseUrl: productionUrl,
}), false)

console.log('achieve deployment safety: all checks passed')
