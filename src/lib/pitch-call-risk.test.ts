// Self-check for the pure pitch-call risk helpers. No framework — run with:
//   node src/lib/pitch-call-risk.test.ts   (Node 22+ strips the types)
import assert from 'node:assert/strict'
import {
  isPitchCall,
  talkTimeBand,
  pitchCallRisk,
  explainPitchRisk,
} from './pitch-call-risk.ts'

// --- eligibility: tolerant of case/punctuation, either field ---
assert.equal(isPitchCall({ campaign_name: 'Cal.com Meeting' }), true)
assert.equal(isPitchCall({ campaign_name: 'CAL_COM_MEETING - Inbound' }), true)
assert.equal(isPitchCall({ disposition: 'CALL NOW REQUESTED' }), true)
assert.equal(isPitchCall({ disposition: 'call-now  requested' }), true)
assert.equal(isPitchCall({ campaign_name: 'Cold Outreach' }), false)
assert.equal(isPitchCall({ campaign_name: null, disposition: null }), false)
assert.equal(isPitchCall({}), false)

// --- bands by seconds: 1800 / 2400 boundaries ---
assert.equal(talkTimeBand(0), 'unknown')
assert.equal(talkTimeBand(null), 'unknown')
assert.equal(talkTimeBand(1799), 'high')
assert.equal(talkTimeBand(1800), 'watch') // 30m exactly → watch
assert.equal(talkTimeBand(2399), 'watch')
assert.equal(talkTimeBand(2400), 'target') // 40m exactly → target
assert.equal(talkTimeBand(3600), 'target')

// --- combined: non-pitch never gets a band ---
assert.deepEqual(pitchCallRisk({ campaign_name: 'Cold', talk_time: 100 }), {
  isPitch: false,
  band: 'unknown',
  rushed: false,
})
assert.deepEqual(
  pitchCallRisk({ campaign_name: 'Cal.com Meeting', talk_time: 1200 }),
  { isPitch: true, band: 'high', rushed: true },
)
assert.equal(
  pitchCallRisk({ disposition: 'CALL NOW REQUESTED', talk_time: 2700 }).rushed,
  false,
)
// pitch call with no talk time → unknown, not rushed
assert.deepEqual(
  pitchCallRisk({ campaign_name: 'Cal.com Meeting', talk_time: 0 }),
  { isPitch: true, band: 'unknown', rushed: false },
)

// --- explanation mentions the band reason ---
assert.match(
  explainPitchRisk({ campaign_name: 'Cal.com Meeting', talk_time: 1200 }),
  /rushed/i,
)

console.log('pitch-call-risk: all assertions passed')
