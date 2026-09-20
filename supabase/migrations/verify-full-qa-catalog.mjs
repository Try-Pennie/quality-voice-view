import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const expectedHash = '1396c17a6ae639b1172a1ff5d04ee21b22e4ab5ceb08c5915c090a34da291e37'
const here = dirname(fileURLToPath(import.meta.url))
const migrationPath = resolve(here, '20260918020000_full_qa_rubric_feedback.sql')
const backendPromptPath = process.argv[2]
if (!backendPromptPath) throw new Error('Usage: node verify-full-qa-catalog.mjs /path/to/eavesly/prompts/full-qa.txt')

const [migration, backendPrompt] = await Promise.all([readFile(migrationPath, 'utf8'), readFile(resolve(backendPromptPath), 'utf8')])
const promptStart = migration.indexOf('$full_qa_prompt$') + '$full_qa_prompt$'.length
const promptEnd = migration.indexOf('$full_qa_prompt$', promptStart)
if (promptStart < '$full_qa_prompt$'.length || promptEnd < 0) throw new Error('Catalog prompt block is missing')
const catalogPrompt = migration.slice(promptStart, promptEnd)
const digest = value => createHash('sha256').update(value).digest('hex')
if (catalogPrompt !== backendPrompt || digest(catalogPrompt) !== expectedHash) throw new Error('Catalog prompt bytes differ from the backend source')

const manifestStart = migration.indexOf('$manifest$') + '$manifest$'.length
const manifestEnd = migration.indexOf('$manifest$', manifestStart)
const manifest = JSON.parse(migration.slice(manifestStart, manifestEnd))
if (manifest.length !== 23 || new Set(manifest.map(item => item.key)).size !== 23) throw new Error('Manifest must contain 23 unique criteria')
const forbiddenScores = manifest.flatMap(item => item.domain).filter(value => typeof value === 'number')
if (forbiddenScores.length) throw new Error('Full QA score domains must not contain invented numeric scales')
console.log(`verified exact prompt ${expectedHash} (${Buffer.byteLength(catalogPrompt)} bytes) and ${manifest.length} criteria`)
