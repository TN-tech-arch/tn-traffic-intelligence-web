/** Verify Module 4 task timestamps are converted from UTC to Asia/Shanghai. */

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const BASE = process.env.TN_UI_BASE ?? 'http://127.0.0.1:8077'
const SHOTS = path.resolve('..', 'data', 'screenshots')
const sourcePath = path.resolve('src', 'utils', 'shanghaiDateTime.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
const { formatShanghaiDateTime } = await import(moduleUrl)

const results = []

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`)
}

const formatCases = [
  ['2026-10-21T15:43:56Z', '2026-10-21 23:43:56'],
  ['2026-10-21T15:59:59Z', '2026-10-21 23:59:59'],
  ['2026-10-21T16:00:00Z', '2026-10-22 00:00:00'],
  ['2026-01-31T16:00:00Z', '2026-02-01 00:00:00'],
  ['2026-12-31T16:00:00Z', '2027-01-01 00:00:00'],
  ['2028-02-28T16:00:00Z', '2028-02-29 00:00:00'],
]

for (const [input, expected] of formatCases) {
  const actual = formatShanghaiDateTime(input)
  check(`UTC ${input}`, actual === expected, `${actual} | expected ${expected}`)
}

for (const invalid of [null, undefined, '', 'not-a-date']) {
  const actual = formatShanghaiDateTime(invalid)
  check(`invalid ${String(invalid)}`, actual === '—', actual)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })

await page.goto(`${BASE}/training`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForSelector('.tn-m4-layout', { timeout: 60000 })

const experiments = (
  await (await fetch(`${BASE}/api/experiments?limit=500`)).json()
).experiments
const candidates = experiments.filter((item) => item.scope === 'single').slice(0, 6)
const historyIndex = candidates.findIndex((item) => item.started_at)
if (historyIndex < 0) throw new Error('No experiment with a task start time is available')

const selected = candidates[historyIndex]
const expectedStart = formatShanghaiDateTime(selected.started_at)
const historyItems = page.locator('.tn-m4-history-item')
await historyItems.nth(historyIndex).waitFor({ state: 'visible', timeout: 60000 })
const historyText = await historyItems.nth(historyIndex).innerText()
const rawStart = selected.started_at.replace('T', ' ').replace('Z', '')
check(
  'history start time uses Asia/Shanghai',
  historyText.includes(expectedStart) && !historyText.includes(rawStart),
  `${selected.started_at} -> ${expectedStart}`,
)

await historyItems.nth(historyIndex).locator('button').first().click()
await page.getByTestId('m4-current-details').waitFor({ state: 'visible', timeout: 30000 })
const detailsText = await page.getByTestId('m4-current-details').innerText()
check(
  'current experiment start time uses Asia/Shanghai',
  detailsText.includes(expectedStart),
  expectedStart,
)

const logs = (await (await fetch(`${BASE}/api/experiments/${selected.experiment_id}/logs`)).json()).logs
const firstLogTime = logs.find((entry) => entry.at)?.at
if (!firstLogTime) throw new Error('Selected experiment has no timestamped training log')
const expectedLogTime = formatShanghaiDateTime(firstLogTime)
const logText = await page.getByTestId('m4-training-logs').innerText()
check(
  'training log time uses Asia/Shanghai',
  logText.includes(`[${expectedLogTime}]`),
  `${firstLogTime} -> ${expectedLogTime}`,
)

fs.mkdirSync(SHOTS, { recursive: true })
await page.screenshot({
  path: path.join(SHOTS, 'module4-time-display.png'),
  fullPage: true,
  animations: 'disabled',
})
await browser.close()

const failed = results.filter((result) => !result.ok).length
fs.writeFileSync(
  path.join(SHOTS, 'module4-time-display-results.json'),
  JSON.stringify({ base: BASE, formatCases, results }, null, 2),
)
console.log(`\n${results.length - failed}/${results.length} Module 4 time-format checks passed`)
process.exit(failed ? 1 : 0)
