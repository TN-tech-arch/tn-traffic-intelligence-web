/** Historical Module 5 evaluations with mixed outcomes must remain viewable. */

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.TN_UI_BASE ?? 'http://127.0.0.1:8077'
const SHOTS = path.resolve('..', 'data', 'screenshots')
fs.mkdirSync(SHOTS, { recursive: true })

const response = await fetch(`${BASE}/api/evaluations?limit=50`)
if (!response.ok) throw new Error(`Evaluation history request failed: ${response.status}`)
const evaluations = (await response.json()).evaluations ?? []
const target = evaluations.find((item) => item.status === 'Partial')
if (!target) throw new Error('No Partial evaluation is available for history regression')
const targetIndex = evaluations.findIndex((item) => item.evaluation_id === target.evaluation_id)
const targetPage = Math.floor(targetIndex / 6) + 1
const datasets = (await (await fetch(`${BASE}/api/datasets?include_archived=true`)).json()).datasets ?? []
let currentDataset = null
let currentExperiment = null
for (const dataset of datasets) {
  if (dataset.scope !== 'single' || dataset.dataset_id === target.dataset_id) continue
  const candidates =
    (await (await fetch(`${BASE}/api/experiments?dataset_id=${encodeURIComponent(dataset.dataset_id)}&limit=500`)).json())
      .experiments ?? []
  const experiment = candidates.find((item) => ['Completed', 'Partial'].includes(item.status))
  if (experiment) {
    currentDataset = dataset
    currentExperiment = experiment
    break
  }
}
if (!currentDataset || !currentExperiment) {
  throw new Error('No independent current configuration is available for history regression')
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1680, height: 1100 } })
const browserErrors = []
page.on('pageerror', (error) => browserErrors.push(String(error)))
page.on('console', (message) => message.type() === 'error' && browserErrors.push(message.text()))

try {
  await page.goto(
    `${BASE}/evaluation?dataset=${encodeURIComponent(currentDataset.dataset_id)}&experiment=${encodeURIComponent(currentExperiment.experiment_id)}`,
    { waitUntil: 'domcontentloaded', timeout: 60000 },
  )
  const setup = page.getByTestId('m5-evaluation-setup')
  await setup.waitFor({ state: 'visible', timeout: 60000 })
  await setup.locator('.tn-m5-dataset-mini').waitFor({ state: 'visible', timeout: 30000 })
  const setupSnapshot = async () => ({
    dataset: await setup.locator('[data-field="m5.dataset_id"] .ant-select-selection-item').innerText(),
    selectValues: await setup.locator('.ant-select-selection-item').allTextContents(),
    checked: await setup
      .locator('input[type="checkbox"]:checked')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid'))),
    datasetInfo: await setup.locator('.tn-m5-dataset-mini').innerText(),
  })
  const setupBefore = await setupSnapshot()
  if (targetPage > 1) {
    await page.locator(`.ant-pagination-item-${targetPage}`).click()
    await page.waitForTimeout(600)
  }
  const row = page.locator(`[data-evaluation-id="${target.evaluation_id}"]`)
  await row.waitFor({ state: 'visible', timeout: 60000 })
  if (!(await row.innerText()).includes('部分完成')) {
    throw new Error(`History row is not labelled 部分完成: ${target.evaluation_id}`)
  }
  await row.getByRole('button').first().click()
  await page.getByTestId('m5-forecast-details').getByText('正在查看历史评价').waitFor({ timeout: 30000 })
  const setupAfter = await setupSnapshot()
  if (JSON.stringify(setupBefore) !== JSON.stringify(setupAfter)) {
    throw new Error('Opening evaluation history changed the left configuration')
  }
  await page.waitForFunction(
    () => {
      const prediction = document.querySelector('[data-testid="m5-prediction-chart"]')
      const errorChart = document.querySelector('[data-testid="m5-error-chart"]')
      return (
        Number(prediction?.getAttribute('data-point-count') ?? 0) > 0 &&
        Number(prediction?.getAttribute('data-series-count') ?? 0) > 0 &&
        Number(errorChart?.getAttribute('data-point-count') ?? 0) > 0
      )
    },
    undefined,
    { timeout: 60000 },
  )
  if (browserErrors.length) throw new Error(browserErrors.join(' | '))
  await page.screenshot({
    path: path.join(SHOTS, 'module5-partial-history.png'),
    fullPage: true,
    animations: 'disabled',
  })
  console.log(
    `PASS  ${target.evaluation_id} 部分完成历史记录可打开，成功成员曲线已加载`,
  )
} finally {
  await browser.close()
}
