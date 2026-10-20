/**
 * Module 2 regression for the simplified configuration and real cluster output.
 */

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
const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } })
const consoleErrors = []
page.on('pageerror', (error) => consoleErrors.push(String(error)))
page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()))

await page.goto(`${BASE}/clustering`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
await page
  .locator('.tn-range-summary')
  .filter({ hasText: '数据可用范围' })
  .waitFor({ state: 'visible', timeout: 30000 })
  .catch(() => undefined)

const configPane = page.locator('.tn-three-pane > section').nth(0)
const centerPane = page.locator('.tn-three-pane > section').nth(1)
const infoPane = page.locator('.tn-three-pane > section').nth(2)

const selectSource = async (label) => {
  await page.locator('[data-field="m2.source_key"] .ant-select-selector').click()
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: label })
    .first()
    .click()
  await page.waitForTimeout(500)
}
await selectSource('Milano')

const grid = page.locator('.tn-three-pane').first()
const columns = await grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns)
const widths = columns.split(' ').map((value) => parseFloat(value))
const total = widths.reduce((sum, value) => sum + value, 0)
const ratios = widths.map((value) => Math.round((value / total) * 1000) / 10)
check(
  '1 三栏比例约为 25% / 40% / 35%',
  Math.abs(ratios[0] - 25) <= 2.5 &&
    Math.abs(ratios[1] - 40) <= 2.5 &&
    Math.abs(ratios[2] - 35) <= 2.5,
  `${columns} → ${ratios.join('/')}%`,
)

const initialText = await configPane.innerText()
check(
  '2 不再显示时间分辨率与聚合方式控件',
  (await page.locator('[data-field="m2.frequency"]').count()) === 0 &&
    (await page.locator('[data-field="m2.aggregation"]').count()) === 0,
  'resampling controls removed',
)
check(
  '3 默认分析范围覆盖完整真实数据',
  initialText.includes('数据可用范围：2013-11-01 00:00:00 ～ 2014-01-01 23:50:00') &&
    initialText.includes('实际开始：2013-11-01 00:00:00') &&
    initialText.includes('最后一个有效观测：2014-01-01 23:50:00'),
  initialText.split('\n').filter((line) => line.includes('2013-11-01') || line.includes('2014-01-01')).join(' | '),
)
check(
  '4 高级参数入口已移除，核心参数仍存在',
  (await page.locator('[data-field="m2.n_init"]').count()) === 0 &&
    (await page.locator('[data-field="m2.random_state"]').count()) === 0 &&
    (await page.locator('[data-field="m2.n_clusters"] input').count()) === 1 &&
    (await page.locator('[data-field="m2.features"]').count()) === 1,
  'advanced fields hidden',
)

await page.locator('#field-m2_n_clusters').fill('9')
await page.locator('#field-m2_standardize').uncheck()
await configPane.locator('button').filter({ hasText: '重置配置' }).click()
await page.waitForFunction(
  () => {
    const input = document.querySelector('#field-m2_n_clusters')
    const checkbox = document.querySelector('#field-m2_standardize')
    return input?.value === '4' && checkbox instanceof HTMLInputElement && checkbox.checked
  },
  undefined,
  { timeout: 15000 },
)
await page.waitForTimeout(800)
const resetText = await configPane.innerText()
const resetOk =
  (await page.locator('#field-m2_n_clusters').inputValue()) === '4' &&
  (await page.locator('#field-m2_standardize').isChecked()) &&
  resetText.includes('实际开始：2013-11-01 00:00:00')
check(
  '5 重置配置恢复核心参数并回到完整范围',
  resetOk,
  JSON.stringify({
    k: await page.locator('#field-m2_n_clusters').inputValue(),
    standardize: await page.locator('#field-m2_standardize').isChecked(),
    fullRange: resetText.includes('实际开始：2013-11-01 00:00:00'),
  }),
)

const beforeRuns = await page.evaluate(async () => {
  const response = await fetch('/api/clusters?limit=50')
  return (await response.json()).runs.map((run) => run.cluster_run_id)
})

await configPane.locator('button').filter({ hasText: '开始聚类' }).click()
let started = null
for (let attempt = 0; attempt < 60; attempt += 1) {
  await page.waitForTimeout(1000)
  started = await page.evaluate(async (baseline) => {
    const response = await fetch('/api/clusters?limit=50')
    const runs = (await response.json()).runs
    return runs.find(
      (run) =>
        run.algorithm_key === 'kmeans' &&
        !baseline.includes(run.cluster_run_id),
    )
  }, beforeRuns)
  if (started) break
}
check('6a 当前测试创建了独立的新聚类运行', Boolean(started), started?.cluster_run_id ?? 'not created')
if (!started) throw new Error('current Module 2 run was not created')
await page
  .locator('.tn-history-row')
  .filter({ hasText: started?.cluster_run_id ?? 'not-created' })
  .first()
  .waitFor({ state: 'visible', timeout: 180000 })

let newest = started
for (let attempt = 0; attempt < 180 && newest?.status !== 'Completed'; attempt += 1) {
  await page.waitForTimeout(1000)
  newest = await page.evaluate(async (runId) => {
    const response = await fetch(`/api/clusters/${runId}`)
    return await response.json()
  }, started.cluster_run_id)
}
check(
  '6 新聚类使用可读 CLUS 标识且真实完成',
  Boolean(newest?.cluster_run_id) &&
    /^CLUS-MILANO-KMEANS-\d{4,}$/.test(newest.cluster_run_id) &&
    newest.status === 'Completed',
  newest?.cluster_run_id ?? 'missing',
)

const detail = await page.evaluate(async (runId) => {
  const response = await fetch(`/api/clusters/${runId}`)
  return await response.json()
}, newest.cluster_run_id)
const regions = detail.result?.regions ?? []
const clusters = detail.result?.clusters ?? []
const assigned = new Set(regions.map((row) => row.region_id))
check(
  '7 K=4 返回真实 4 簇且区域唯一归属',
  clusters.length === 4 &&
    regions.length === 88 &&
    assigned.size === 88 &&
    clusters.reduce((sum, cluster) => sum + cluster.region_count, 0) === 88,
  `${clusters.length} clusters, ${regions.length} regions, ${assigned.size} unique`,
)

const legendIds = await centerPane
  .locator('.tn-legend-swatch[data-cluster-id]')
  .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-cluster-id'))))
check(
  '8 图例只显示实际簇并保持颜色映射',
  JSON.stringify([...new Set(legendIds)].sort((a, b) => a - b)) === JSON.stringify([0, 1, 2, 3]),
  legendIds.join(','),
)

await infoPane.locator('.ant-tabs-tab').filter({ hasText: '典型模式' }).click()
await page.waitForTimeout(800)
const patternText = await infoPane.innerText()
check(
  '9 典型模式包含全部簇与真实 Insights',
  patternText.includes('各簇平均日内模式') &&
    patternText.includes('Cluster Pattern Insights') &&
    patternText.includes('簇 0') &&
    patternText.includes('簇 3'),
  patternText.split('\n').slice(0, 6).join(' | '),
)

const weeklyCard = infoPane.locator('.ant-card').filter({ hasText: '周内差异' }).first()
const weeklyChart = weeklyCard.locator('[data-testid="cluster-weekly-pattern-chart"]')
await weeklyChart.waitFor({ state: 'visible', timeout: 30000 })
const weeklySeries = JSON.parse(await weeklyChart.getAttribute('data-weekly-series'))
const normalizedMeansOk = weeklySeries.every((item) => {
  const finite = (item.normalized ?? []).filter((value) => value !== null && Number.isFinite(value))
  if (!finite.length) return (item.raw ?? []).every((value) => value === null)
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length
  return Math.abs(mean - 1) < 1e-9
})
check(
  '9b 周内图默认开启归一化且每簇有效周平均为 1',
  (await weeklyChart.getAttribute('data-normalized')) === 'true' &&
    (await weeklyChart.getAttribute('data-y-axis-title')) === '相对水平（各簇周均值＝1）' &&
    normalizedMeansOk,
  JSON.stringify(weeklySeries.map((item) => item.mean)),
)

await weeklyChart.scrollIntoViewIfNeeded()
const weeklyBox = await weeklyChart.locator('.echarts-for-react').boundingBox()
await page.mouse.move(weeklyBox.x + weeklyBox.width * 0.52, weeklyBox.y + weeklyBox.height * 0.4)
await page.waitForTimeout(600)
const weeklyTooltip = await weeklyChart.evaluate((root) =>
  Array.from(root.querySelectorAll('div'))
    .filter(
      (node) =>
        getComputedStyle(node).position === 'absolute' &&
        node.textContent?.includes('归一化＝原始周均值'),
    )
    .at(-1)?.textContent ?? '',
)
check(
  '9c 周内 Tooltip 同时显示原始平均流量与归一化值',
  weeklyTooltip.includes('原始平均') &&
    weeklyTooltip.includes('归一化') &&
    /\d/.test(weeklyTooltip),
  weeklyTooltip.replace(/\s+/g, ' ').slice(0, 120),
)

await weeklyCard.locator('.ant-switch').click()
await page.waitForFunction(
  () =>
    document
      .querySelector('[data-testid="cluster-weekly-pattern-chart"]')
      ?.getAttribute('data-normalized') === 'false',
  undefined,
  { timeout: 10000 },
)
const displayedOff = JSON.parse(await weeklyChart.getAttribute('data-displayed-series'))
check(
  '9d 关闭归一化后恢复原始流量、纵轴标题和原始数据序列',
  (await weeklyChart.getAttribute('data-y-axis-title')) === '平均流量值' &&
    JSON.stringify(displayedOff) === JSON.stringify(weeklySeries.map((item) => item.raw)),
  (await weeklyChart.getAttribute('data-y-axis-title')) ?? 'missing',
)

await infoPane.locator('.ant-tabs-tab').filter({ hasText: '质量评估' }).click()
await page.waitForTimeout(700)
const qualityText = await infoPane.innerText()
check(
  '10 质量评估展示真实指标或明确不可计算原因',
  /Silhouette|Davies|Calinski|无法计算|不可计算/.test(qualityText),
  qualityText.split('\n').slice(0, 8).join(' | '),
)

const headers = await centerPane.locator('section[aria-label="Region List"] th').allInnerTexts()
check(
  '11 区域列表不再显示第三列“模式”',
  !headers.some((header) => header.includes('模式')),
  headers.join('|'),
)

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
check('12 1600px 无横向溢出', overflow <= 1, `overflow=${overflow}`)
check('13 浏览器控制台无未预期错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

await page.screenshot({ path: path.join(SHOTS, 'module2-current.png'), fullPage: true })
await browser.close()

const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} Module 2 checks passed`)
process.exit(failed ? 1 : 0)
