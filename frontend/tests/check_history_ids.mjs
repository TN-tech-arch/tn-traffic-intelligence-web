/** Module 2-5 regression for persisted readable history IDs. */

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
const page = await browser.newPage({ viewport: { width: 1600, height: 1300 } })
const consoleErrors = []
page.on('pageerror', (error) => consoleErrors.push(String(error)))
page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()))

await page.goto(`${BASE}/clustering`, { waitUntil: 'networkidle' })
await page.locator('.tn-history-row').first().waitFor({ state: 'visible', timeout: 60000 })
const clusterHistory = await page.locator('.tn-history-row').allInnerTexts()
check(
  'Module 2 history renders CLUS IDs',
  clusterHistory.length > 0 && clusterHistory.every((text) => /CLUS-[A-Z0-9-]+-\d{4,}/.test(text)),
  `${clusterHistory.length} rows`,
)
await page.screenshot({ path: path.join(SHOTS, 'history-ids-module2.png'), fullPage: true })

await page.goto(`${BASE}/dataset`, { waitUntil: 'networkidle' })
await page.locator('.tn-m3-dataset-row').first().waitFor({ state: 'visible', timeout: 60000 })
const datasetRows = await page.locator('.tn-m3-dataset-row').allInnerTexts()
const datasetApi = await page.evaluate(async () => {
  const response = await fetch('/api/datasets?include_archived=true')
  return (await response.json()).datasets
})
const visibleDatasetIds = datasetApi
  .filter(
    (row) =>
      row.display_id !== row.dataset_id &&
      datasetRows.some((text) => text.includes(row.display_id ?? row.dataset_id)),
  )
  .map((row) => row.dataset_id)
const datasetBody = datasetRows.join('\n')
check(
  'Module 3 management renders DS IDs',
  datasetRows.length > 0 && datasetRows.every((text) => /DS-[A-Z0-9-]+-\d{4,}/.test(text)),
  `${datasetRows.length} visible rows`,
)
check(
  'Module 3 management does not show the visible rows legacy IDs',
  visibleDatasetIds.every((legacy) => !datasetBody.includes(legacy)),
  `${visibleDatasetIds.length} checked`,
)
await page.screenshot({ path: path.join(SHOTS, 'history-ids-module3.png'), fullPage: true })

await page.goto(`${BASE}/training`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.tn-m4-layout', { timeout: 60000 })
await page.getByTestId('m4-experiment-history').waitFor({ state: 'visible', timeout: 60000 })
await page.waitForTimeout(1000)
const experimentApi = await page.evaluate(async () => {
  const response = await fetch('/api/experiments?limit=500')
  return (await response.json()).experiments
})
const batchApi = await page.evaluate(async () => {
  const response = await fetch('/api/batches?limit=200')
  return (await response.json()).batches
})
const trainingText = await page.getByTestId('m4-experiment-history').innerText()
check(
  'Module 4 batch records remain available with BATCH display IDs',
  batchApi.every((row) => /^BATCH-[A-Z0-9-]+-\d{4,}$/.test(row.display_id ?? row.batch_id)),
  `${batchApi.length} batches available`,
)
check(
  'Module 4 history renders EXP IDs',
  /EXP-[A-Z0-9-]+-\d{4,}/.test(trainingText),
  `${experimentApi.length} experiments available`,
)
const visibleLegacy = [
  ...batchApi.filter((row) => row.display_id !== row.batch_id).map((row) => row.batch_id),
  ...experimentApi.filter((row) => row.display_id !== row.experiment_id).map((row) => row.experiment_id),
].filter((legacy) => trainingText.includes(legacy))
check(
  'Module 4 visible history has no legacy ULID labels',
  visibleLegacy.length === 0,
  visibleLegacy.slice(0, 3).join(' | '),
)
await page.screenshot({ path: path.join(SHOTS, 'history-ids-module4.png'), fullPage: true })

await page.goto(`${BASE}/evaluation`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const evaluationApi = await page.evaluate(async () => {
  const response = await fetch('/api/evaluations?limit=200')
  return (await response.json()).evaluations
})
const evaluationExperiments = evaluationApi.flatMap((row) => row.experiments ?? [])
check(
  'Module 5 evaluation members expose EXP display IDs',
  evaluationExperiments.length === 0 ||
    evaluationExperiments.every((row) => /^EXP-[A-Z0-9-]+-\d{4,}$/.test(row.display_id ?? '')),
  `${evaluationExperiments.length} members`,
)
await page.screenshot({ path: path.join(SHOTS, 'history-ids-module5.png'), fullPage: true })

check(
  'No unexpected browser errors',
  consoleErrors.filter((line) => !/favicon|ResizeObserver/.test(line)).length === 0,
  consoleErrors.slice(0, 2).join(' | '),
)

const failed = results.filter((result) => !result.ok).length
fs.writeFileSync(
  path.join(SHOTS, 'history-id-regression.json'),
  JSON.stringify({ base: BASE, results, counts: {
    clusters: clusterHistory.length,
    visibleDatasets: datasetRows.length,
    experiments: experimentApi.length,
    batches: batchApi.length,
    evaluationExperiments: evaluationExperiments.length,
  } }, null, 2),
)
await browser.close()
console.log(`\n${results.length - failed}/${results.length} history ID UI checks passed`)
process.exit(failed ? 1 : 0)
