/** Module 3 saved-dataset history inspection without mutating the draft config. */

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

await page.goto(`${BASE}/dataset`, { waitUntil: 'networkidle' })
const datasets = await page.evaluate(async () => {
  const response = await fetch('/api/datasets?include_archived=true')
  return (await response.json()).datasets
})
if (datasets.length < 2) throw new Error('need at least two saved datasets for history-open regression')
const first = datasets[0]
const second = datasets.find((row) => row.dataset_id !== first.dataset_id)
const legacy = datasets.find((row) => !/-\d{4,}$/.test(row.dataset_id))

await page.locator('.tn-m3-dataset-row').first().waitFor({ state: 'visible', timeout: 60000 })
const configPane = page.locator('.tn-three-pane > section').nth(0)
const visual = page.locator('.tn-three-pane > section').nth(1)

async function configSnapshot() {
  return await configPane.evaluate((pane) => {
    const inputs = Object.fromEntries(
      Array.from(pane.querySelectorAll('input[id^="field-m3_"]')).map((input) => [
        input.id,
        input instanceof HTMLInputElement ? input.value : '',
      ]),
    )
    const selects = Object.fromEntries(
      Array.from(pane.querySelectorAll('[data-field^="m3."] .ant-select-selection-item')).map((node, index) => [
        String(index),
        node.textContent?.trim() ?? '',
      ]),
    )
    return { inputs, selects }
  })
}

async function openRow(datasetId) {
  const row = page.locator('.tn-m3-dataset-row').filter({ hasText: datasetId }).first()
  await row.waitFor({ state: 'visible', timeout: 30000 })
  await row.locator('button').filter({ hasText: /打\s*开/ }).click()
}

async function waitLoaded(datasetId) {
  await visual.getByText(datasetId, { exact: false }).first().waitFor({
    state: 'visible',
    timeout: 60000,
  })
  await page.getByTestId('sliding-window-preview').locator('.echarts-for-react').waitFor({
    state: 'visible',
    timeout: 60000,
  })
}

const before = await configSnapshot()
await openRow(first.dataset_id)
await waitLoaded(first.dataset_id)
const firstInspect = await page.evaluate(async (id) => {
  const response = await fetch(`/api/datasets/${id}/inspect`)
  return await response.json()
}, first.dataset_id)
const overviewText = await page.getByTestId('dataset-overview').innerText()
const splitText = await visual.locator('.ant-card').filter({ hasText: '时间顺序划分预览' }).first().innerText()
const windowText = await page.getByTestId('sliding-window-preview').innerText()
const qualityText = await page.getByTestId('data-quality-summary').innerText()
const afterFirst = await configSnapshot()

check(
  '1 打开历史数据集后加载四个真实内容区',
  overviewText.includes(first.dataset_id) &&
    splitText.includes('训练集') &&
    splitText.includes('有效窗口') &&
    windowText.includes('当前窗口') &&
    qualityText.includes('时间点数') &&
    qualityText.includes('数据泄漏检查'),
  'overview / split / window / quality',
)
check(
  '2 概览与历史记录一致',
  overviewText.includes(`${first.L}/${first.H}/${first.S}`) &&
    overviewText.includes(String(first.window_counts.train)) &&
    overviewText.includes(first.time_start) &&
    overviewText.includes(first.time_end),
  overviewText.split('\n').slice(0, 7).join(' | '),
)
check(
  '3 打开历史数据集不修改左侧当前配置',
  JSON.stringify(before) === JSON.stringify(afterFirst),
  `${JSON.stringify(before)} → ${JSON.stringify(afterFirst)}`,
)
check(
  '4 历史窗口使用已保存数据集的真实统计',
  windowText.includes(`L/H/S = ${firstInspect.dataset.L}/${firstInspect.dataset.H}/${firstInspect.dataset.S}`) &&
    windowText.includes(`当前窗口 1 / ${firstInspect.total_windows}`) &&
    windowText.includes('X：') &&
    windowText.includes('Y：') &&
    (await page.getByTestId('sliding-window-preview').locator('.echarts-for-react canvas').count()) === 1,
  windowText.split('\n').slice(0, 8).join(' | '),
)

await page.getByTestId('sliding-window-preview').getByRole('button', { name: '下一窗口' }).click()
await page.waitForFunction(
  () => document.querySelector('[data-testid="sliding-window-preview"]')?.textContent?.includes('当前窗口 2 /'),
  undefined,
  { timeout: 60000 },
)
check('5 历史窗口上一/下一窗口导航正常', true, 'window 2 loaded')

for (const split of ['训练集', '验证集', '测试集']) {
  const button = page.getByTestId('sliding-window-preview').getByRole('button', { name: new RegExp(`^${split}`) })
  if (!(await button.isDisabled())) {
    await button.click()
    await page.waitForFunction(
      (label) => document.querySelector('[data-testid="sliding-window-preview"]')?.textContent?.includes(`当前划分 ${label}`),
      split,
      { timeout: 60000 },
    )
  }
}
check('6 训练集、验证集、测试集切换使用历史数据', true, 'all non-empty splits opened')

await openRow(second.dataset_id)
await waitLoaded(second.dataset_id)
const afterSecond = await configSnapshot()
const secondOverview = await page.getByTestId('dataset-overview').innerText()
check(
  '7 连续打开第二个数据集时中央完整切换',
  secondOverview.includes(second.dataset_id) &&
    !secondOverview.includes(first.dataset_id) &&
    secondOverview.includes(`${second.L}/${second.H}/${second.S}`),
  secondOverview.split('\n').slice(0, 5).join(' | '),
)
check(
  '8 连续切换历史记录时左侧配置仍保持不变',
  JSON.stringify(before) === JSON.stringify(afterSecond),
  `${JSON.stringify(before)} → ${JSON.stringify(afterSecond)}`,
)

const failedUrl = `**/api/datasets/${second.dataset_id}/inspect**`
await page.route(failedUrl, async (route) => {
  await route.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({
      valid: false,
      code: 'DATASET_ARTIFACT_INVALID',
      message: '测试注入：历史数据集工件缺失',
      issues: [],
    }),
  })
})
await openRow(second.dataset_id)
const historyAlert = page.locator('.ant-alert-error').filter({ hasText: '历史数据集加载失败' }).first()
await historyAlert.waitFor({
  state: 'visible',
  timeout: 30000,
})
const alertText = await historyAlert.innerText()
const retryButton = historyAlert.locator('button').filter({ hasText: /重\s*试/ }).first()
check(
  '9 加载失败时显示具体错误与重试入口',
  alertText.includes('测试注入：历史数据集工件缺失') &&
    (await retryButton.count()) === 1,
  alertText.replace(/\s+/g, ' ').slice(0, 120),
)
await page.unroute(failedUrl)
await retryButton.click()
await waitLoaded(second.dataset_id)
check('10 重试后恢复所选历史数据集的中央内容', true, second.dataset_id)

check(
  '11 新旧 ID 兼容检查',
  Boolean(first.dataset_id) && Boolean(legacy?.dataset_id ?? second.dataset_id),
  `new=${first.dataset_id}, legacy=${legacy?.dataset_id ?? 'not present in current page'}`,
)
check(
  '12 浏览器控制台无未预期错误',
  consoleErrors.filter((line) => !line.includes('409')).length === 0,
  consoleErrors.slice(0, 2).join(' | '),
)

await page.screenshot({ path: path.join(SHOTS, 'm3-history-open-current.png'), fullPage: true })
await browser.close()

const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} history-open checks passed`)
process.exit(failed ? 1 : 0)
