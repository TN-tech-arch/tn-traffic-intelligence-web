/** Module 5: two-column manual-comparison workflow and five-section workspace. */

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

async function waitForEvaluation(evaluationId, timeoutMs = 180000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`${BASE}/api/evaluations/${evaluationId}`)
    if (response.ok) {
      const body = await response.json()
      if (['Completed', 'Failed', 'Stopped'].includes(body.status)) return body
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  throw new Error(`Evaluation ${evaluationId} did not finish in time`)
}

const datasets = (await (await fetch(`${BASE}/api/datasets?include_archived=true`)).json()).datasets
  .filter((item) => item.scope === 'single' && item.status !== 'Archived')
const experiments = (await (await fetch(`${BASE}/api/experiments?limit=500`)).json()).experiments
  .filter((item) => item.scope === 'single' && ['Completed', 'Partial'].includes(item.status))
const dataset = datasets
  .map((item) => ({
    item,
    candidates: experiments.filter((experiment) => experiment.dataset_id === item.dataset_id),
  }))
  .sort((left, right) => right.candidates.length - left.candidates.length)[0]
if (!dataset || dataset.candidates.length < 3) throw new Error('Not enough real experiments for Module 5 regression')

const grouped = new Map()
for (const experiment of dataset.candidates) {
  const group = grouped.get(experiment.algorithm_label) ?? []
  group.push(experiment)
  grouped.set(experiment.algorithm_label, group)
}
const repeated = [...grouped.values()].find((group) => group.length >= 2)
const distinct = dataset.candidates.find(
  (experiment) =>
    repeated && !repeated.some((candidate) => candidate.experiment_id === experiment.experiment_id),
)
if (!repeated || !distinct) throw new Error('Repeated-model experiment pair is unavailable')
const selectedExperiments = [repeated[0], repeated[1], distinct]

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1680, height: 1100 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))

await page.goto(`${BASE}/evaluation?dataset=${encodeURIComponent(dataset.item.dataset_id)}`, {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
await page.waitForSelector('[data-field="m5.dataset_id"]', { timeout: 60000 })
await page.locator('.tn-m5-experiment-list').waitFor({ timeout: 60000 })

const columns = await page.locator('.tn-three-pane.tn-two-pane').evaluate(
  (node) => getComputedStyle(node).gridTemplateColumns,
)
const widths = columns.split(' ').map((value) => Number.parseFloat(value))
check(
  '1 Module 5 uses the Module 3/4-style two-column layout',
  widths.length === 2 &&
    Math.abs(widths[0] / (widths[0] + widths[1]) - 0.32) <= 0.01 &&
    Math.abs(widths[1] / (widths[0] + widths[1]) - 0.68) <= 0.01 &&
    (await page.locator('.tn-pane-info').count()) === 0,
  columns,
)

const sectionTitles = await page
  .locator('.tn-m5-workspace > .ant-card > .ant-card-head .ant-card-head-title')
  .allInnerTexts()
check(
  '2 five central sections are vertically ordered without tabs',
  sectionTitles.length === 5 &&
    sectionTitles[0].includes('预测详情') &&
    sectionTitles[1].includes('预测对比') &&
    sectionTitles[2].includes('预测时域分析') &&
    sectionTitles[3].includes('误差分析') &&
    sectionTitles[4].includes('评估概览') &&
    (await page.locator('.ant-tabs').count()) === 0,
  sectionTitles.join(' | '),
)

const leftText = await page.locator('.tn-three-pane.tn-two-pane > .tn-pane').first().innerText()
check(
  '3 horizon selector is not in the left configuration',
  !leftText.includes('预测步长') &&
    !leftText.includes('Batch ID') &&
    (await page.locator('[data-field="m5.horizon_step"]').count()) === 0 &&
    (await page.locator('[data-testid="m5-horizon-selector"]').count()) === 1,
)
check(
  '4 no export or download controls remain',
  !(await page.locator('body').innerText()).includes('导出') &&
    !(await page.locator('body').innerText()).includes('下载') &&
    (await page.getByRole('link').filter({ hasText: /CSV|Excel/ }).count()) === 0,
)

const checkedBefore = await page.locator('.tn-m5-experiment-list input[type="checkbox"]:checked').count()
check('5 experiments are not auto-selected', checkedBefore === 0, String(checkedBefore))

for (const experiment of selectedExperiments) {
  const checkbox = page.locator(`[data-testid="m5-experiment-${experiment.experiment_id}"]`)
  await checkbox.scrollIntoViewIfNeeded()
  await checkbox.click()
}
const selectedText = await page.locator('.tn-m5-selected-summary').innerText()
check(
  '6 repeated-model experiments remain separate selectable EXP records',
  selectedExperiments.every((experiment) => selectedText.includes(experiment.display_id)) &&
    selectedText.includes(repeated[0].display_id) &&
    selectedText.includes(repeated[1].display_id),
  selectedExperiments.map((item) => item.display_id).join(' | '),
)

const runButton = page.getByTestId('m5-run-evaluation')
await runButton.waitFor({ state: 'visible' })
check('7 run evaluation is enabled after manual selection', await runButton.isEnabled())
const [runResponse] = await Promise.all([
  page.waitForResponse(
    (response) => response.url().endsWith('/api/evaluations/run') && response.request().method() === 'POST',
    { timeout: 30000 },
  ),
  runButton.click(),
])
const created = await runResponse.json()
const completed = await waitForEvaluation(created.evaluation_id)
check('8 real evaluation completes', completed.status === 'Completed', `${created.evaluation_id} · ${completed.status}`)
check(
  '8.1 saved protocol keeps exact EXP IDs, test range and overall/per-step metrics',
  selectedExperiments.every((experiment) =>
    (completed.protocol?.selected_experiments ?? []).some(
      (item) => item.experiment_id === experiment.experiment_id && item.display_id === experiment.display_id,
    ),
  ) &&
    Number(completed.test_range?.window_count ?? 0) > 0 &&
    (completed.metrics_summary?.experiments ?? []).every(
      (item) =>
        (item.per_horizon ?? []).length === Number(dataset.item.H) &&
        Number(item.macro?.n_samples ?? 0) > 0,
    ),
)

await page.waitForFunction(
  (evaluationId) => document.body.innerText.includes(evaluationId),
  created.evaluation_id,
  { timeout: 60000 },
)
const detailCards = page.locator('[data-testid="m5-forecast-details"] .tn-m5-selected-card')
check(
  '9 forecast details restore the exact selected experiment list',
  (await detailCards.count()) === selectedExperiments.length &&
    (await page.getByTestId('m5-forecast-details').innerText()).includes(dataset.item.display_id),
  String(await detailCards.count()),
)

const comparisonCard = page.getByTestId('m5-prediction-comparison')
await comparisonCard.locator('.ant-select-selector').click()
await page.locator('.ant-select-dropdown:visible').waitFor({ state: 'visible', timeout: 10000 })
const hOptions = await page.locator('.ant-select-dropdown:visible .ant-select-item-option').allInnerTexts()
check(
  '10 comparison horizon selector exposes h=1 through H',
  hOptions.length === Number(dataset.item.H) &&
    hOptions[0].includes('h=1') &&
    hOptions.at(-1).includes(`h=${dataset.item.H}`),
  `options=${hOptions.join(',')} expectedH=${dataset.item.H}`,
)
await page.locator('.ant-select-dropdown:visible .ant-select-item-option').last().click()
await page.waitForTimeout(500)
const horizonRows = await page.locator('[data-testid="m5-horizon-analysis"] tbody tr').count()
check(
  '11 horizon analysis still contains every step after changing display h',
  horizonRows >= Number(dataset.item.H) * selectedExperiments.length,
  `${horizonRows} rows`,
)
await page.locator('[data-testid="m5-evaluation-overview"] tbody tr').first().waitFor({ timeout: 60000 })
await page.waitForFunction(
  ({ ids, rowCount }) => {
    const overview = document.querySelector('[data-testid="m5-evaluation-overview"]')
    const text = overview?.textContent ?? ''
    return overview?.querySelectorAll('tbody tr').length === rowCount && ids.every((id) => text.includes(id))
  },
  { ids: selectedExperiments.map((item) => item.display_id), rowCount: selectedExperiments.length },
  { timeout: 60000 },
)
const overviewText = await page.getByTestId('m5-evaluation-overview').innerText()
const overviewRows = await page.getByTestId('m5-evaluation-overview').locator('tbody tr').count()
check(
  '12 overview contains real overall metrics and EXP IDs',
  overviewText.includes('整体指标') &&
    selectedExperiments.every((experiment) => overviewText.includes(experiment.display_id)) &&
    overviewRows === selectedExperiments.length,
  `rows=${overviewRows}; missing=${selectedExperiments
    .filter((experiment) => !overviewText.includes(experiment.display_id))
    .map((experiment) => experiment.display_id)
    .join(',')}`,
)

await page.goto(`${BASE}/evaluation?dataset=${encodeURIComponent(dataset.item.dataset_id)}`, {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
await page.getByTestId('m5-history').waitFor({ state: 'visible', timeout: 60000 })
const historyRow = page.locator(`[data-evaluation-id="${created.evaluation_id}"]`)
await historyRow.waitFor({ state: 'visible', timeout: 60000 })
await historyRow.getByRole('button').filter({ hasText: /查\s*看/ }).click()
await page.getByTestId('m5-forecast-details').getByText('正在查看历史评价').waitFor({ timeout: 30000 })
check(
  '13 history view restores the saved evaluation context',
  (await page.getByTestId('m5-forecast-details').innerText()).includes('正在查看历史评价'),
)

await page.screenshot({
  path: path.join(SHOTS, 'module5-five-section-results.png'),
  fullPage: true,
  animations: 'disabled',
})

await historyRow.getByRole('button').filter({ hasText: /删\s*除\s*记\s*录/ }).click()
const popconfirm = page.locator('.ant-popconfirm').last()
await popconfirm.waitFor({ state: 'visible' })
await popconfirm.getByRole('button').filter({ hasText: /确定|确 定/ }).click()
await page.waitForTimeout(1200)
const deletedResponse = await fetch(`${BASE}/api/evaluations/${created.evaluation_id}`)
check(
  '14 deleting evaluation history preserves training records',
  deletedResponse.status === 404 &&
    (await (await fetch(`${BASE}/api/experiments/${selectedExperiments[0].experiment_id}`)).ok),
)

await page.setViewportSize({ width: 840, height: 1100 })
await page.waitForTimeout(400)
const responsiveColumns = await page.locator('.tn-three-pane.tn-two-pane').evaluate(
  (node) => getComputedStyle(node).gridTemplateColumns,
)
check('15 narrow layout collapses to one column', responsiveColumns.split(' ').length === 1, responsiveColumns)
check(
  '16 browser has no unexpected errors',
  errors.filter((line) => !/favicon|ResizeObserver|409 \(Conflict\)|404 \(Not Found\)/.test(line)).length === 0,
  errors.slice(0, 3).join(' | '),
)

await browser.close()
const failed = results.filter((result) => !result.ok).length
fs.writeFileSync(
  path.join(SHOTS, 'module5-five-section-results.json'),
  JSON.stringify({
    base: BASE,
    dataset: dataset.item.dataset_id,
    selected_experiments: selectedExperiments.map((item) => item.display_id),
    evaluation_id: created.evaluation_id,
    results,
  }, null, 2),
)
console.log(`\n${results.length - failed}/${results.length} Module 5 redesign checks passed`)
process.exit(failed ? 1 : 0)
