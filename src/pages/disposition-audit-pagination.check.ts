// Self-check for disposition-audit-pagination — this repo has no test runner.
// Run: npx tsx src/pages/disposition-audit-pagination.check.ts
import assert from 'node:assert/strict'
import { paginate } from './disposition-audit-pagination'

const source = Array.from({ length: 23 }, (_, index) => index + 1)
const snapshot = [...source]

assert.deepEqual(paginate(source, 1, 10), {
  items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  page: 1,
  pageCount: 3,
  start: 1,
  end: 10,
  total: 23,
})
assert.deepEqual(paginate(source, 3, 10), {
  items: [21, 22, 23],
  page: 3,
  pageCount: 3,
  start: 21,
  end: 23,
  total: 23,
})
assert.equal(paginate(source, 99, 10).page, 3, 'pages above the range clamp to the last page')
assert.equal(paginate(source, 0, 10).page, 1, 'pages below the range clamp to the first page')
assert.deepEqual(paginate([], 4, 25), {
  items: [],
  page: 1,
  pageCount: 1,
  start: 0,
  end: 0,
  total: 0,
})
assert.throws(() => paginate(source, 1, 0), RangeError)
assert.deepEqual(source, snapshot, 'pagination must not mutate query rows')

console.log('disposition-audit-pagination checks passed')
