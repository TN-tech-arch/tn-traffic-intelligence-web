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
await page
  .locator('.tn-range-summary')
  .filter({ hasText: '数据可用范围' })
  .waitFor({ state: 'visible', timeout: 30000 })
  .catch(() => undefined)

const grid = page.locator('.tn-three-pane').first()
const columns = await grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns)
const widths = columns.split(' ').map((value) => parseFloat(value))
const total = widths.reduce((sum, value) => sum + value, 0)
const ratios = widths.map((value) => Math.round((value / total) * 1000) / 10)
check(
  '0a Module 2 三栏比例为约 25% / 40% / 35%',
  Math.abs(ratios[0] - 25) <= 2.5 &&
    Math.abs(ratios[1] - 40) <= 2.5 &&
    Math.abs(ratios[2] - 35) <= 2.5,
  `${columns} → ${ratios.join('/')}%`,
)
const initialConfigPane = page.locator('.tn-three-pane > section').nth(0)
const initialText = await initialConfigPane.innerText()
check(
  '0b 起始索引和窗口点数不再作为普通参数显示',
  (await page.locator('[data-field="m2.start_index"]').count()) === 0 &&
    (await page.locator('[data-field="m2.window_points"]').count()) === 0 &&
    (await page.locator('[data-field="m2.time_start"] input').count()) === 1 &&
    (await page.locator('[data-field="m2.time_end"] input').count()) === 1,
  'date/time controls only',
)
check(
  '0c 日期范围摘要来自真实时间索引',
  initialText.includes('数据可用范围') &&
    initialText.includes('选中时间点') &&
    initialText.includes('有效观测') &&
    initialText.includes('采样间隔'),
  initialText.split('\n').slice(-8).join(' | '),
)
const startInput = page.locator('[data-field="m2.time_start"] input').first()
await startInput.click()
await startInput.fill('2013-11-02 00:00')
await startInput.press('Enter')
await page
  .locator('.tn-range-summary')
  .filter({ hasText: '2013-11-02 00:00:00' })
  .waitFor({ state: 'visible', timeout: 20000 })
  .catch(() => undefined)
const updatedRangeText = await initialConfigPane.innerText()
check(
  '0d 修改开始日期后真实范围摘要同步更新',
  updatedRangeText.includes('2013-11-02 00:00:00'),
  updatedRangeText.split('\n').filter((line) => line.includes('2013-11-02')).join(' | '),
)
await startInput.click()
await startInput.fill('2013-11-01 00:00')
await startInput.press('Enter')
await page.waitForTimeout(1000)

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

const selectAlgorithm = async (label) => {
  await page.locator('[data-field="m2.algorithm"] .ant-select-selector').click()
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: label })
    .first()
    .click()
  await page.waitForTimeout(250)
}
const inputValue = (selector) =>
  page.locator(selector).evaluate((element) => element.value)

await page.locator('#field-m2_hierarchical_n_clusters').fill('5')
const hierarchicalK = await inputValue('#field-m2_hierarchical_n_clusters')
await page.locator('[data-field="m2.linkage"] .ant-select-selector').click()
await page
  .locator('.ant-select-dropdown:visible .ant-select-item-option')
  .filter({ hasText: 'complete' })
  .first()
  .click()
const hierarchicalLinkage = await configPane.innerText()
check(
  '2a Hierarchical 的 K 与连接方式可编辑',
  hierarchicalK === '5' && hierarchicalLinkage.includes('完全连接（complete）'),
  `K=${hierarchicalK}`,
)
await page.locator('#field-m2_hierarchical_n_clusters').fill('4')
await page.locator('[data-field="m2.linkage"] .ant-select-selector').click()
await page
  .locator('.ant-select-dropdown:visible .ant-select-item-option')
  .filter({ hasText: 'ward' })
  .first()
  .click()

await selectAlgorithm('谱聚类（Spectral Clustering）')
await page.locator('#field-m2_spectral_n_neighbors').fill('12')
const spectralNeighbors = await inputValue('#field-m2_spectral_n_neighbors')
await page.locator('[data-field="m2.spectral_affinity"] .ant-select-selector').click()
await page
  .locator('.ant-select-dropdown:visible .ant-select-item-option')
  .filter({ hasText: 'rbf' })
  .first()
  .click()
await page.locator('#field-m2_spectral_gamma').fill('0.7')
check(
  '2b Spectral 的邻居数、affinity 与 gamma 可编辑',
  spectralNeighbors === '12' &&
    (await inputValue('#field-m2_spectral_gamma')) === '0.7',
  'spectral parameters',
)

await selectAlgorithm('K-Means')
await page.locator('#field-m2_n_clusters').fill('5')
check(
  '2c K-Means 的簇数量可编辑',
  (await inputValue('#field-m2_n_clusters')) === '5',
  `K=${await inputValue('#field-m2_n_clusters')}`,
)

await selectAlgorithm('高斯混合（GMM）')
await page.locator('#field-m2_gmm_n_components').fill('5')
check(
  '2d GMM 的高斯分量数可编辑',
  (await inputValue('#field-m2_gmm_n_components')) === '5',
  `components=${await inputValue('#field-m2_gmm_n_components')}`,
)

await selectAlgorithm('层次聚类（Hierarchical）')
await page.locator('#field-m2_hierarchical_n_clusters').fill('4')
await historyRow.locator('button').filter({ hasText: /打\s*开/ }).first().click()
await centerPane
  .locator('.tn-legend')
  .filter({ hasText: /簇 0（/ })
  .waitFor({ state: 'visible', timeout: 20000 })
  .catch(() => undefined)
await page.waitForTimeout(800)

const tabs = (await infoPane.locator('.ant-tabs-nav').first().locator('.ant-tabs-tab').allInnerTexts()).map((text) => text.trim())
check(
  '3 右侧仅保留三个分析 Tab',
  ['Cluster Overview', 'Typical Patterns', 'Quality Evaluation'].every((text) =>
    tabs.some((tab) => tab.includes(text)),
  ) && !tabs.some((tab) => tab.includes('Region List')),
  tabs.join(' | '),
)

const centralText = await centerPane.innerText()
check(
  '3b 中央顺序为 GIS → 特征空间 → 区域列表',
  centralText.indexOf('GIS 簇分布') >= 0 &&
    centralText.indexOf('GIS 簇分布') < centralText.indexOf('特征空间') &&
    centralText.indexOf('特征空间') < centralText.indexOf('区域列表') &&
    (await centerPane.locator('section[aria-label="Region List"]').count()) === 1,
  'central order',
)

const overviewText = await panel.innerText()
check(
  '4 K=4 与 13+40+11+24=88 的唯一归属来自真实结果',
  /实际簇数 4/.test(overviewText) &&
    /归属检查 88\/88/.test(overviewText) &&
    /全部唯一归属/.test(overviewText),
  overviewText.split('\n').slice(0, 3).join(' | '),
)

const clusterCards = panel.locator('.ant-card').filter({ hasText: /簇 [0-3]（/ })
check('5 概览显示四个独立簇卡片', (await clusterCards.count()) === 4, `${await clusterCards.count()} cards`)
const cluster0Text = await panel.locator('.ant-card').filter({ hasText: '簇 0（高流量·高波动型）' }).first().innerText()
const cluster2Text = await panel.locator('.ant-card').filter({ hasText: '簇 2（中低流量·高波动型）' }).first().innerText()
const cluster1Text = await panel.locator('.ant-card').filter({ hasText: '簇 1（中高流量·波动适中型）' }).first().innerText()
const cluster3Text = await panel.locator('.ant-card').filter({ hasText: '簇 3（中流量·平稳型）' }).first().innerText()
check(
  '6 四个簇使用真实分布生成不同名称与统计描述',
  cluster0Text.includes('高流量·高波动型') &&
    cluster1Text.includes('中高流量·波动适中型') &&
    cluster2Text.includes('中低流量·高波动型') &&
    cluster3Text.includes('中流量·平稳型') &&
    cluster0Text.includes('命名依据：Mean 百分位') &&
    cluster0Text.includes('流量最高') &&
    cluster2Text.includes('流量最低') &&
    cluster1Text.includes('流量较高') &&
    cluster3Text.includes('流量较低'),
  'distribution-driven names and characterizations',
)
check(
  '7 分类名称不推断土地用途且不使用旧“日间高峰型”',
  !cluster0Text.includes('日间高峰型') &&
    !cluster0Text.includes('日间偏强型') &&
    (await centerPane.innerText()).includes('不推断商业、办公、住宅或通勤'),
  'statistical names only',
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
  '11 Feature Space 使用 PCA 并标出 PC1/PC2 解释方差',
  /PC1（\d+\.\d%）/.test(scatterAxes ?? '') &&
    /PC2（\d+\.\d%）/.test(scatterAxes ?? '') &&
    (await centerPane.innerText()).includes('实际聚类使用 7 个标准化特征') &&
    (await centerPane.innerText()).includes('PCA 仅用于可视化') &&
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
  '14 Cluster Pattern Insights 解释真实峰谷与质心分离依据',
  patternInsightText.includes('簇 0 峰值 13:00') &&
    patternInsightText.includes('簇 2 峰值 18:00') &&
    patternInsightText.includes('标准化质心差异最大') &&
    patternInsightText.includes('日周期强度') &&
    patternInsightText.includes('观测窗口约 7.0 天'),
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

const regionSection = centerPane.locator('section[aria-label="Region List"]')
const regionText = await regionSection.innerText()
check(
  '18 区域列表包含区域、簇、模式类型与真实特征值',
  regionText.includes('区域') &&
    regionText.includes('模式类型') &&
    regionText.includes('Mean') &&
    regionText.includes('Std') &&
    regionText.includes('CV') &&
    regionText.includes('簇 3'),
  regionText.replace(/\n/g, ' | ').slice(0, 160),
)
const regionSearch = regionSection.locator('input[placeholder="搜索区域名称或 ID"]')
await regionSearch.fill('BRERA')
await page.waitForTimeout(300)
const searchRows = await regionSection.locator('tbody tr').allInnerTexts()
check(
  '18b 区域搜索正常',
  searchRows.length === 1 && searchRows[0].includes('BRERA'),
  searchRows.join(' | '),
)
await regionSearch.fill('')
await page.waitForTimeout(200)
await regionSection.locator('.ant-select-selector').click()
await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '簇 3' }).first().click()
await page.waitForTimeout(300)
const filteredRows = await regionSection.locator('tbody tr').allInnerTexts()
check(
  '18c 按簇筛选正常',
  filteredRows.length > 0 && filteredRows.every((row) => row.includes('簇 3')),
  `${filteredRows.length} rows`,
)
await regionSection.locator('.ant-select-selector').click()
await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '全部簇' }).first().click()
await page.waitForTimeout(200)
check(
  '18d 区域列表分页正常',
  (await regionSection.locator('.ant-pagination').count()) === 1 &&
    (await regionSection.locator('tbody tr').count()) <= 10,
  `rows=${await regionSection.locator('tbody tr').count()}`,
)
await regionSection.locator('tbody tr').first().locator('button').filter({ hasText: /定\s*位/ }).click()
await page.waitForTimeout(900)
check(
  '19 区域定位联动 GIS 且保留选择逻辑',
  /已选 [A-Z]/.test(await centerPane.innerText()),
  (await centerPane.innerText()).match(/已选 \S+ · 簇 \d+（[^）]+）/)?.[0] ?? 'no selection',
)
await page.mouse.move(1450, 1250)
await page.waitForTimeout(250)
await page.screenshot({ path: path.join(SHOTS, '44-m2-regions.png'), fullPage: true })

const latestSpectral = await page.evaluate(async () => {
  const response = await fetch('/api/clusters?limit=100')
  const data = await response.json()
  return data.runs.find((run) => run.algorithm_key === 'spectral' && run.status === 'Completed')
})
const spectralRow = page
  .locator('.tn-history-row')
  .filter({ hasText: latestSpectral?.cluster_run_id ?? '__missing_spectral__' })
  .first()
await spectralRow.locator('button').filter({ hasText: /打\s*开/ }).first().click()
await centerPane
  .locator('.tn-legend')
  .filter({ hasText: /簇 0（/ })
  .waitFor({ state: 'visible', timeout: 20000 })
  .catch(() => undefined)
await infoPane.locator('.ant-tabs-tab', { hasText: 'Cluster Overview' }).click()
await page.waitForTimeout(400)
const spectralLegendText = await centerPane.locator('.tn-legend').first().innerText()
check(
  '20 Spectral 使用真实结果、统一名称且没有噪声分类',
  Boolean(latestSpectral?.cluster_run_id) &&
    /簇 \d+（[^）]+）/.test(spectralLegendText) &&
    !spectralLegendText.includes('噪声') &&
    !(await centerPane.innerText()).includes('DBSCAN') &&
    (await page.locator('body').innerText()).includes('Spectral Clustering'),
  `${latestSpectral?.cluster_run_id ?? 'missing'} | ${spectralLegendText.replace(/\n/g, ' | ')}`,
)

const staleDateInput = configPane.locator('[data-field="m2.time_start"] input').first()
await staleDateInput.click()
await staleDateInput.fill('2013-11-03 00:00')
await staleDateInput.press('Enter')
await page.waitForTimeout(700)
check(
  '20b 修改配置后明确提示旧结果已过期',
  (await page.locator('body').innerText()).includes('当前配置已修改，下方仍是上一次聚类结果'),
  'stale result warning',
)

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
check('21 宽屏页面无横向溢出', overflow <= 1, `overflow=${overflow}`)
await page.setViewportSize({ width: 1200, height: 1000 })
await page.waitForTimeout(500)
const overflow1200 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
check('21b 1200px 中等屏幕无横向溢出', overflow1200 <= 1, `overflow=${overflow1200}`)
await page.setViewportSize({ width: 900, height: 1000 })
await page.waitForTimeout(500)
const overflow900 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
check('21c 900px 窄屏无横向溢出', overflow900 <= 1, `overflow=${overflow900}`)
check('22 浏览器控制台无未预期错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

await page.setViewportSize({ width: 1600, height: 1200 })
await page.waitForTimeout(500)

const selectFieldOption = async (field, label) => {
  await page.locator(`[data-field="m2.${field}"] .ant-select-selector`).click()
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: label })
    .first()
    .click()
  await page.waitForTimeout(150)
}

await selectAlgorithm('谱聚类（Spectral Clustering）')
await page.locator('#field-m2_spectral_n_neighbors').fill('14')
await selectFieldOption('spectral_affinity', 'rbf')
await page.locator('#field-m2_spectral_gamma').fill('0.8')
await selectAlgorithm('K-Means')
await page.locator('#field-m2_n_clusters').fill('9')
await page.locator('#field-m2_n_init').fill('77')
await page.locator('#field-m2_random_state').fill('99')
await selectFieldOption('frequency', '30 分钟')
await selectFieldOption('aggregation', '求和')
await page.locator('#field-m2_standardize').uncheck()
await selectAlgorithm('层次聚类（Hierarchical）')
await page.locator('#field-m2_hierarchical_n_clusters').fill('8')
await selectFieldOption('linkage', 'complete')
await selectFieldOption('metric', 'manhattan')
await selectAlgorithm('高斯混合（GMM）')
await page.locator('#field-m2_gmm_n_components').fill('7')
await selectFieldOption('covariance_type', 'diag')
await page.locator('#field-m2_reg_covar').fill('0.2')
await page.locator('#field-m2_random_state').fill('99')

await configPane.locator('button').filter({ hasText: '重置配置' }).click()
await page
  .waitForFunction(
    () => {
      const pane = document.querySelectorAll('.tn-three-pane > section')[0]
      const text = pane?.textContent ?? ''
      return (
        text.includes('K-Means') &&
        text.includes('原生') &&
        text.includes('实际开始：2013-11-01 00:00:00')
      )
    },
    null,
    { timeout: 30000 },
  )
  .catch(() => undefined)
const resetText = await configPane.innerText()
const resetInfo = await infoPane.innerText()
const resetBasic = {
  algorithm: resetText.includes('K-Means'),
  frequency: resetText.includes('原生'),
  aggregation: resetText.includes('均值'),
  date: resetText.includes('实际开始：2013-11-01 00:00:00'),
  k: (await inputValue('#field-m2_n_clusters')) === '4',
  nInit: (await inputValue('#field-m2_n_init')) === '10',
  randomState: (await inputValue('#field-m2_random_state')) === '42',
  standardize: await page.locator('#field-m2_standardize').isChecked(),
  features:
    (await page.locator('[data-field="m2.features"] .ant-select-selection-item').count()) === 7,
  resultCleared: resetInfo.includes('尚无聚类结果'),
  noStale: !(await page.locator('body').innerText()).includes('当前配置已修改，下方仍是上一次聚类结果'),
}
check(
  '23 重置配置恢复全部基础参数并清除旧结果',
  Object.values(resetBasic).every(Boolean),
  JSON.stringify(resetBasic),
)

await selectAlgorithm('层次聚类（Hierarchical）')
const resetHierarchical = {
  k: await inputValue('#field-m2_hierarchical_n_clusters'),
  text: await configPane.locator('[data-field="m2.linkage"]').innerText(),
  metric: await configPane.locator('[data-field="m2.metric"]').innerText(),
}
await selectAlgorithm('谱聚类（Spectral Clustering）')
const resetSpectral = {
  k: await inputValue('#field-m2_spectral_n_clusters'),
  affinity: await configPane.locator('[data-field="m2.spectral_affinity"]').innerText(),
  neighbors: await inputValue('#field-m2_spectral_n_neighbors'),
  randomState: await inputValue('#field-m2_random_state'),
}
await selectFieldOption('spectral_affinity', 'rbf')
resetSpectral.gamma = await inputValue('#field-m2_spectral_gamma')
await selectAlgorithm('高斯混合（GMM）')
const resetGmm = {
  components: await inputValue('#field-m2_gmm_n_components'),
  covariance: await configPane.locator('[data-field="m2.covariance_type"]').innerText(),
  reg: await inputValue('#field-m2_reg_covar'),
  randomState: await inputValue('#field-m2_random_state'),
}
check(
  '23b 重置后各算法的隐藏高级参数也恢复默认值',
  resetHierarchical.k === '4' &&
    resetHierarchical.text.includes('ward') &&
    resetHierarchical.metric.includes('euclidean') &&
    resetSpectral.k === '4' &&
    resetSpectral.affinity.includes('nearest_neighbors') &&
    resetSpectral.neighbors === '10' &&
    resetSpectral.gamma === '1' &&
    resetSpectral.randomState === '42' &&
    resetGmm.components === '4' &&
    resetGmm.covariance.includes('full') &&
    resetGmm.reg === '0.000001' &&
    resetGmm.randomState === '42',
  `${JSON.stringify(resetHierarchical)} | ${JSON.stringify(resetSpectral)} | ${JSON.stringify(resetGmm)}`,
)
const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} Module 2 checks passed`)
await browser.close()
process.exit(failed ? 1 : 0)
