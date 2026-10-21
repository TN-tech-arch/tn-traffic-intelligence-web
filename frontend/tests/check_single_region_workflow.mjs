/** M3-M5 regression for the unified single-region workflow. */

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.TN_UI_BASE ?? 'http://127.0.0.1:8077'
const SHOTS = path.resolve('..', 'data', 'screenshots')
const results = []
fs.mkdirSync(SHOTS, { recursive: true })

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))

const datasets = await (await fetch(`${BASE}/api/datasets?include_archived=true`)).json()
const experiments = await (await fetch(`${BASE}/api/experiments?limit=500`)).json()
const batches = await (await fetch(`${BASE}/api/batches?limit=200`)).json()
const evaluations = await (await fetch(`${BASE}/api/evaluations?limit=200`)).json()
check(
  '1 all history APIs return only single-region records',
  datasets.datasets.every((item) => item.scope === 'single') &&
    experiments.experiments.every((item) => item.scope === 'single') &&
    batches.batches.every((item) => item.scope === 'single') &&
    evaluations.evaluations.every((item) => item.scope === 'single'),
  `datasets=${datasets.count}, experiments=${experiments.count}, batches=${batches.count}, evaluations=${evaluations.count}`,
)

await page.goto(`${BASE}/dataset`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-field="m3.region_id"]', { timeout: 60000 })
check(
  '2 Module 3 exposes region but no scope selector',
  (await page.locator('[data-field="m3.region_id"]').count()) === 1 &&
    (await page.locator('[data-field="m3.scope"]').count()) === 0,
)
check(
  '3 Module 3 UI contains no all-region option',
  !(await page.locator('body').innerText()).includes('全部区域'),
)

await page.goto(`${BASE}/training`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tn-m4-layout', { timeout: 60000 })
await page.locator('[data-field="m4.algorithm_key"]').waitFor({ timeout: 60000 })
await page.locator('[data-field="m4.algorithm_key"] .ant-select-selector').click()
const allModelsOption = page
  .locator('.ant-select-dropdown:visible .ant-select-item-option')
  .filter({ hasText: '全部模型' })
  .first()
await allModelsOption.waitFor({ timeout: 30000 })
const trainingText = await page.locator('body').innerText()
check(
  '4 Module 4 has no all-region setting and keeps all-models mode',
  !trainingText.includes('全部区域') &&
    (await allModelsOption.count()) === 1,
)
await page.keyboard.press('Escape')
const scopeRejected = await page.evaluate(async () => {
  const response = await fetch('/api/experiments/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dataset_id: (await (await fetch('/api/datasets')).json()).datasets[0].dataset_id,
      algorithm_key: 'arima',
      scope: 'all',
      params: {},
    }),
  })
  return { status: response.status, body: await response.json() }
})
check(
  '5 Module 4 backend rejects all-region requests',
  scopeRejected.status === 409 && scopeRejected.body.code === 'MULTI_REGION_REMOVED',
)

await page.goto(`${BASE}/evaluation`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tn-three-pane', { timeout: 60000 })
const evaluationText = await page.locator('body').innerText()
check(
  '6 Module 5 exposes no all-region or spatial evaluation tab',
  !evaluationText.includes('全部区域') &&
    !evaluationText.includes('Spatial Evaluation') &&
    (await page.locator('[data-field="m5.scope"]').count()) === 0,
)
check(
  '7 Module 5 keeps single-region comparison and metrics tabs',
  ['Prediction Comparison', 'Error Analysis', 'Forecast Horizon Analysis'].every((label) =>
    evaluationText.includes(label),
  ) &&
    ['Metrics Overview', 'Model Ranking', 'Regional Performance'].every((label) =>
      evaluationText.includes(label),
    ),
)

check(
  '8 browser has no unexpected errors',
  errors.filter((line) => !/favicon|ResizeObserver|409 \(Conflict\)/.test(line)).length === 0,
  errors.slice(0, 2).join(' | '),
)

await page.screenshot({
  path: path.join(SHOTS, 'single-region-workflow-evaluation.png'),
  fullPage: true,
  animations: 'disabled',
})
const failed = results.filter((result) => !result.ok).length
fs.writeFileSync(
  path.join(SHOTS, 'single-region-workflow-results.json'),
  JSON.stringify({ base: BASE, results }, null, 2),
)
await browser.close()
console.log(`\n${results.length - failed}/${results.length} single-region workflow checks passed`)
process.exit(failed ? 1 : 0)
