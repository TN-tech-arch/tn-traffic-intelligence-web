/** Module 3 simplified configuration, full-range default and readable DS ID. */

import { chromium } from 'playwright'
import path from 'node:path'

const BASE = 'http://127.0.0.1:8077'
const SHOTS = path.resolve('..', 'data', 'screenshots')
const results = []

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1500 } })
const consoleErrors = []
page.on('pageerror', (error) => consoleErrors.push(String(error)))
page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()))

let createdDataset = null
try {
  await page.goto(`${BASE}/dataset`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const configPane = page.locator('.tn-three-pane > section').nth(0)
  await configPane.locator('[data-field="m3.source_key"]').waitFor({ state: 'visible', timeout: 30000 })

  const labels = await configPane.locator('.tn-field-label').allInnerTexts()
  check(
    '1 不再显示时间分辨率、聚合方式、数据集名称和高级参数',
    !labels.some((label) => /时间分辨率|聚合方式|数据集名称|缺失值处理|标准化/.test(label)) &&
      (await page.locator('[data-field="m3.frequency"]').count()) === 0 &&
      (await page.locator('[data-field="m3.aggregation"]').count()) === 0 &&
      (await page.locator('[data-field="m3.label"]').count()) === 0,
    labels.join(' | '),
  )
  check(
    '2 不再显示构建时间范围控件，默认使用数据总时间',
    (await page.locator('[data-field="m3.time_start"]').count()) === 0 &&
      (await page.locator('[data-field="m3.time_end"]').count()) === 0 &&
      !(await configPane.innerText()).includes('构建时间范围') &&
      !(await configPane.innerText()).includes('数据可用范围'),
    'date controls and availability note removed',
  )

  await page.locator('#field-m3_input_length').fill('144')
  await page.locator('#field-m3_output_length').fill('24')
  await page.locator('#field-m3_step').fill('144')
  const datasetsBefore = await page.evaluate(async () => {
    const response = await fetch('/api/datasets')
    return (await response.json()).datasets.map((row) => row.dataset_id)
  })
  await configPane.locator('button').filter({ hasText: '构建数据集' }).click()

  await page
    .locator('.tn-m3-dataset-row')
    .filter({ hasText: /DS-MILANO-ADRIANO-/ })
    .first()
    .waitFor({ state: 'visible', timeout: 180000 })

  for (let attempt = 0; attempt < 30 && !createdDataset; attempt += 1) {
    createdDataset = await page.evaluate(async (baseline) => {
      const response = await fetch('/api/datasets')
      const rows = (await response.json()).datasets
      return rows.find(
        (row) =>
          /^DS-MILANO-ADRIANO-\d{4,}$/.test(row.dataset_id) &&
          !baseline.includes(row.dataset_id),
      )
    }, datasetsBefore)
    if (!createdDataset) await page.waitForTimeout(500)
  }
  check(
    '3 新数据集生成可读 DS ID 并作为主要名称',
    Boolean(createdDataset?.dataset_id) &&
      createdDataset.label === createdDataset.dataset_id &&
      createdDataset.frequency === 'native' &&
      createdDataset.frequency_minutes === 10,
    createdDataset?.dataset_id ?? 'missing',
  )
  check(
    '4 已保存数据集覆盖完整真实时间范围',
    createdDataset?.time_start === '2013-11-01 00:00:00' &&
      createdDataset?.time_end === '2014-01-01 23:50:00',
    `${createdDataset?.time_start} → ${createdDataset?.time_end}`,
  )
  check(
    '5 数据集管理列表显示 DS ID',
    (await configPane.innerText()).includes(createdDataset.dataset_id),
    createdDataset.dataset_id,
  )

  await page.goto(`${BASE}/training`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByTestId('m4-experiment-history').waitFor({
    state: 'visible',
    timeout: 60000,
  })
  await page.waitForTimeout(1200)
  const trainingText = await page.locator('body').innerText()
  check(
    '6 模块四继承 DS ID，仅显示数据频率且不显示高级开关',
    trainingText.includes('DS-MILANO-ADRIANO-') &&
      trainingText.includes('采样频率') &&
      trainingText.includes('原生频率') &&
      !trainingText.includes('数据频率 / 聚合') &&
      !trainingText.includes('（继承自数据集）') &&
      !trainingText.includes('仅显示核心参数') &&
      !trainingText.includes('H 继承自数据集') &&
      (await page.locator('.tn-field-label .ant-switch').count()) === 0,
    'training inherits dataset',
  )

  check('7 浏览器控制台无未预期错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  await page.screenshot({ path: path.join(SHOTS, 'module3-simplified.png'), fullPage: true })
} finally {
  if (createdDataset?.dataset_id) {
    await page.evaluate(async (datasetId) => {
      await fetch(`/api/datasets/${datasetId}`, { method: 'DELETE' })
    }, createdDataset.dataset_id).catch(() => undefined)
  }
  await browser.close()
}

const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} Module 3 checks passed`)
process.exit(failed ? 1 : 0)
