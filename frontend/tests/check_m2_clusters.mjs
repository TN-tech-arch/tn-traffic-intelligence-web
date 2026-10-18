/**
 * Module 2 real-result regression:
 * Hierarchical K=4, unique assignments, differentiated characterization,
 * dynamic cluster colours, 2D feature-space note, normalized patterns,
 * pattern insights, quality diagnostics and map linkage.
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

const latestHierarchical = await page.evaluate(async () => {
  const response = await fetch('/api/clusters?limit=20')
  const data = await response.json()
  return data.runs.find((run) => run.algorithm_key === 'hierarchical' && run.status === 'Completed')
})
check('1 存在真实的 Hierarchical 聚类结果', Boolean(latestHierarchical?.cluster_run_id), latestHierarchical?.cluster_run_id ?? 'missing')

const historyRow = page.locator('.tn-history-row').filter({ hasText: 'Hierarchical' }).first()
await historyRow.waitFor({ state: 'visible', timeout: 20000 })
await historyRow.locator('button').filter({ hasText: /打\s*开/ }).first().click()
await page.waitForTimeout(4000)

const configPane = page.locator('.tn-three-pane > section').nth(0)
const centerPane = page.locator('.tn-three-pane > section').nth(1)
const infoPane = page.locator('.tn-three-pane > section').nth(2)
const panel = infoPane.locator('.ant-tabs-tabpane-active')

const parameterLabels = await configPane.locator('.tn-field-label').allInnerTexts()
check(
  '2 Hierarchical 不展示无效的随机种子参数',
  !parameterLabels.some((label) => label.includes('随机种子')) &&
    (await configPane.innerText()).includes('Ward 层次聚类 + 欧氏距离'),
  parameterLabels.join('|'),
)

const tabs = (await infoPane.locator('.ant-tabs-nav').first().locator('.ant-tabs-tab').allInnerTexts()).map((text) => text.trim())
check(
  '3 四个一级 Tab 完整保留',
  ['Cluster Overview', 'Typical Patterns', 'Quality Evaluation', 'Region List'].every((text) =>
    tabs.some((tab) => tab.includes(text)),
  ),
  tabs.join(' | '),
)

const overviewText = await panel.innerText()
check(
  '4 K=4 与 13+40+11+24=88 的唯一归属来自真实结果',
  /实际簇数 4/.test(overviewText) &&
    /归属检查 88\/88/.test(overviewText) &&
    /全部唯一归属/.test(overviewText),
  overviewText.split('\n').slice(0, 3).join(' | '),
)

const clusterCards = panel.locator('.ant-card').filter({ hasText: /^簇 [0-3] ·/ })
check('5 概览显示四个独立簇卡片', (await clusterCards.count()) === 4, `${await clusterCards.count()} cards`)
const cluster0Text = await panel.locator('.ant-card').filter({ hasText: '簇 0 · 13 个区域' }).first().innerText()
const cluster2Text = await panel.locator('.ant-card').filter({ hasText: '簇 2 · 11 个区域' }).first().innerText()
const cluster1Text = await panel.locator('.ant-card').filter({ hasText: '簇 1 · 40 个区域' }).first().innerText()
const cluster3Text = await panel.locator('.ant-card').filter({ hasText: '簇 3 · 24 个区域' }).first().innerText()
check(
  '6 同粗粒度类型的簇具有差异化统计描述',
  cluster0Text.includes('日间高峰型') &&
    cluster2Text.includes('日间高峰型') &&
    cluster1Text.includes('日间偏强型') &&
    cluster3Text.includes('日间偏强型') &&
    cluster0Text.includes('流量最高') &&
    cluster2Text.includes('流量最低') &&
    cluster1Text.includes('流量较高') &&
    cluster3Text.includes('流量较低'),
  '0/2 and 1/3 characterize differently',
)
check(
  '7 土地用途相关推测明确标记为假设',
  cluster0Text.includes('假设') && cluster0Text.includes('未验证真实土地用途'),
  'hypothesis visible',
)
check(
  '8 概览包含与其他簇的主要统计差异',
  cluster0Text.includes('标准化质心差异最大') &&
    cluster0Text.includes('平均流量') &&
    cluster2Text.includes('标准化质心差异最大'),
  'pairwise differences shown',
)
await page.screenshot({ path: path.join(SHOTS, '41-m2-overview.png'), fullPage: true })

const legend = centerPane.locator('.tn-legend').first()
const legendText = await legend.innerText()
const colorRows = await page.locator('[data-cluster-id]').evaluateAll((nodes) =>
  nodes.map((node) => ({
    id: node.getAttribute('data-cluster-id'),
    color: node.getAttribute('data-cluster-color'),
    background: getComputedStyle(node).backgroundColor,
  })),
)
const colorsById = {}
const hexColorsById = {}
for (const row of colorRows) {
  colorsById[row.id] ??= new Set()
  colorsById[row.id].add(row.background)
  hexColorsById[row.id] ??= new Set()
  hexColorsById[row.id].add(row.color)
}
check(
  '9 GIS 图例只展示实际存在的簇 0–3',
  [0, 1, 2, 3].every((id) => legendText.includes(`簇 ${id}`)) &&
    !legendText.includes('簇 4') &&
    !legendText.includes('簇 5'),
  legendText.replace(/\n/g, ' | '),
)
check(
  '10 同一 Cluster ID 在地图图例和概览中使用同一颜色',
  ['0', '1', '2', '3'].every((id) => colorsById[id]?.size === 1) &&
    new Set(['0', '1', '2', '3'].map((id) => [...(colorsById[id] ?? [])][0])).size === 4,
  JSON.stringify(colorsById),
)

const scatter = centerPane.locator('[data-testid="cluster-feature-scatter"]')
const scatterAxes = await scatter.getAttribute('data-cluster-axes')
const scatterColors = JSON.parse((await scatter.getAttribute('data-cluster-colors')) ?? '{}')
check(
  '11 Feature Space 明确为二维展示并标出真实轴名',
  scatterAxes?.includes('平均值（Mean）') &&
    scatterAxes?.includes('标准差（Std）') &&
    (await centerPane.innerText()).includes('实际聚类使用 7 个标准化特征') &&
    (await centerPane.innerText()).includes('二维距离接近不等于必须属于同一簇'),
  scatterAxes ?? 'missing axes',
)
check(
  '12 Feature Space 颜色与 Cluster ID 映射一致',
  ['0', '1', '2', '3'].every((id) => scatterColors[id] === [...(hexColorsById[id] ?? [])][0]),
  JSON.stringify(scatterColors),
)

await infoPane.locator('.ant-tabs-tab', { hasText: 'Typical Patterns' }).click()
await page.waitForTimeout(700)
const patternChart = panel.locator('[data-testid="cluster-pattern-chart"]')
const patternColors = JSON.parse((await patternChart.getAttribute('data-cluster-colors')) ?? '{}')
check(
  '13 典型模式使用同一套簇颜色',
  ['0', '1', '2', '3'].every((id) => patternColors[id] === [...(hexColorsById[id] ?? [])][0]) &&
    (await patternChart.locator('.echarts-for-react').count()) === 1,
  JSON.stringify(patternColors),
)
const patternInsight = panel.locator('.tn-insight-card').filter({ hasText: 'Cluster Pattern Insights' }).first()
const patternInsightText = await patternInsight.innerText()
check(
  '14 Cluster Pattern Insights 解释真实峰谷与 0/2、1/3 分离原因',
  patternInsightText.includes('簇 0 峰值 13:00') &&
    patternInsightText.includes('簇 2 峰值 18:00') &&
    patternInsightText.includes('簇 0 与簇 2') &&
    patternInsightText.includes('簇 1 与簇 3') &&
    patternInsightText.includes('r=0.965') &&
    patternInsightText.includes('r=0.994'),
  patternInsightText.replace(/\n/g, ' | ').slice(0, 160),
)
const normalizeSwitch = panel.locator('.ant-card').filter({ hasText: '各簇平均日内模式' }).locator('.ant-switch').first()
await normalizeSwitch.click()
await page.waitForTimeout(500)
const normalizedText = await panel.innerText()
check(
  '15 支持归一化日内形状比较',
  normalizedText.includes('各簇归一化日内模式') &&
    normalizedText.includes('归一化曲线将每个簇') &&
    normalizedText.includes('不比较原始规模'),
  'normalized mode toggled',
)
await page.screenshot({ path: path.join(SHOTS, '42-m2-patterns.png'), fullPage: true })

await infoPane.locator('.ant-tabs-tab', { hasText: 'Quality Evaluation' }).click()
await page.waitForTimeout(500)
const qualityText = await panel.innerText()
check(
  '16 质量评估使用真实指标并说明 7 天样本限制',
  qualityText.includes('轮廓系数（Silhouette）：0.2436') &&
    qualityText.includes('Davies-Bouldin') &&
    qualityText.includes('Calinski-Harabasz') &&
    qualityText.includes('7.0 天') &&
    qualityText.includes('越低越好') &&
    qualityText.includes('越高'),
  qualityText.replace(/\n/g, ' | ').slice(0, 160),
)
check(
  '17 标准化、Ward/Euclidean 与区域归属检查可见',
  qualityText.includes('已启用') &&
    qualityText.includes('ward') &&
    qualityText.includes('euclidean') &&
    qualityText.includes('88/88') &&
    qualityText.includes('不使用随机种子'),
  'algorithm and assignment diagnostics',
)
await page.screenshot({ path: path.join(SHOTS, '43-m2-quality.png'), fullPage: true })

await infoPane.locator('.ant-tabs-tab', { hasText: 'Region List' }).click()
await page.waitForTimeout(500)
const regionText = await panel.innerText()
check(
  '18 区域列表包含区域、簇、模式类型与真实特征值',
  regionText.includes('区域') &&
    regionText.includes('模式类型') &&
    regionText.includes('平均值') &&
    regionText.includes('簇 3'),
  regionText.replace(/\n/g, ' | ').slice(0, 160),
)
await panel.locator('tbody tr').first().locator('button').filter({ hasText: /定\s*位/ }).click()
await page.waitForTimeout(900)
check(
  '19 区域定位联动 GIS 且保留选择逻辑',
  /已选 [A-Z]/.test(await centerPane.innerText()),
  (await centerPane.innerText()).match(/已选 \S+（簇 \d+）/)?.[0] ?? 'no selection',
)
await page.mouse.move(1450, 1250)
await page.waitForTimeout(250)
await page.screenshot({ path: path.join(SHOTS, '44-m2-regions.png'), fullPage: true })

const dbscanRow = page.locator('.tn-history-row').filter({ hasText: 'DBSCAN' }).first()
await dbscanRow.locator('button').filter({ hasText: /打\s*开/ }).first().click()
await page.waitForTimeout(3000)
await infoPane.locator('.ant-tabs-tab', { hasText: 'Cluster Overview' }).click()
await page.waitForTimeout(400)
const noiseLegendText = await centerPane.locator('.tn-legend').first().innerText()
const noiseColor = await centerPane
  .locator('.tn-legend span')
  .filter({ hasText: '噪声（-1）' })
  .locator('.tn-legend-swatch')
  .evaluate((node) => getComputedStyle(node).backgroundColor)
  .catch(() => 'missing')
check(
  '20 DBSCAN 噪声使用独立灰色并单独进入图例',
  noiseLegendText.includes('噪声（-1）') &&
    noiseColor === 'rgb(139, 139, 139)' &&
    (await infoPane.innerText()).includes('DBSCAN 噪声点不构成功能区模式'),
  `${noiseColor} | ${noiseLegendText.replace(/\n/g, ' | ')}`,
)

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
check('21 页面无横向溢出', overflow <= 1, `overflow=${overflow}`)
check('22 浏览器控制台无未预期错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} Module 2 checks passed`)
await browser.close()
process.exit(failed ? 1 : 0)
