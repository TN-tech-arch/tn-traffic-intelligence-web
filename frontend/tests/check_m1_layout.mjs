/**
 * Final Module 1 layout verification (integrated instruction):
 *  - 25% / 40% / 35% columns
 *  - left: no Advanced Settings, Max Comparison Regions in the main panel
 *  - centre: GIS -> multi-region series (no fitted line) -> multi-region stats + insights
 *  - right: Analysis Target above three outer tabs, three secondary time tabs
 *  - switching the target must not change the central statistics
 *  - responsive breakpoints without horizontal overflow
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
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

await page.goto(`${BASE}/exploration`, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)

const grid = page.locator('.tn-three-pane').first()
const columns = await grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns)
const widths = columns.split(' ').map((value) => parseFloat(value))
const total = widths.reduce((a, b) => a + b, 0)
const ratios = widths.map((w) => Math.round((w / total) * 1000) / 10)
check(
  '1 三栏比例约为 25% / 40% / 35%',
  Math.abs(ratios[0] - 25) <= 2.5 && Math.abs(ratios[1] - 40) <= 2.5 && Math.abs(ratios[2] - 35) <= 2.5,
  `columns=${columns} → ${ratios.join('/')}%`,
)

// ---------------------------------------------------------------- left ----
const leftPane = page.locator('.tn-three-pane > section').nth(0)
const leftText = await leftPane.innerText()
check('2 左侧不再有 Advanced Settings 入口', !leftText.includes('Advanced Settings'), 'no advanced entry')
check(
  '3 左侧顺序：数据源 → 最多对比区域数 → 区域 → 分辨率',
  ['数据源', '最多对比区域数', '区域（可多选对比）', '时间分辨率'].every(
    (label, index, all) => leftText.indexOf(label) >= 0 && (index === 0 || leftText.indexOf(label) > leftText.indexOf(all[index - 1])),
  ),
  'max regions is above regions',
)
check('4 日期范围与范围摘要仍在', (await page.locator('[data-field="m1.time_start"] input').count()) === 1 && leftText.includes('实际起点') && leftText.includes('时间跨度'), 'date pickers + summary')
check('5 已移除可见的时间索引输入', (await page.locator('[data-field="m1.start_index"] input').count()) === 0, 'no index inputs')

// ------------------------------------------------------------- centre ----
const centerPane = page.locator('.tn-three-pane > section').nth(1)
const centerText = await centerPane.innerText()
const order = [
  centerText.indexOf('GIS & Temporal Visualization'),
  centerText.indexOf('多区域时序曲线'),
  centerText.indexOf('多区域统计摘要'),
  centerText.indexOf('Statistical Summary Insights'),
]
check(
  '6 中央顺序：地图 → 时序 → 多区域统计 → Insights',
  order.every((value, index) => value >= 0 && (index === 0 || value > order[index - 1])),
  order.join(' < '),
)
check('7 中央时序不再有橙色拟合线/图例', !centerText.includes('趋势拟合'), 'fitted line removed')
check('8 中央统计包含范围与样本说明', /参与区域 \d+/.test(centerText) && centerText.includes('有效样本'), 'range note present')
check('9 GIS 蓝色说明框已删除，改为 ⓘ', (await page.locator('.tn-hint').count()) === 0 && (await page.locator('[aria-label="Time Slice 帮助"]').count()) === 1, 'no hint boxes, one help icon')
check('10 地图图例、滑块、区域名称开关仍在', centerText.includes('No Data') && centerText.includes('Time Slice') && centerText.includes('在地图上显示区域名称'), 'map controls intact')

// --------------------------------------------------------- right pane ----
const infoPane = page.locator('.tn-three-pane > section').nth(2)
const infoText = await infoPane.innerText()
check(
  '11 Analysis Target 位于 Temporal 内部顶部',
  infoText.indexOf('Temporal Analysis') >= 0 &&
    infoText.indexOf('Analysis Target') > infoText.indexOf('Temporal Analysis') &&
    infoText.indexOf('Analysis Target') < infoText.indexOf('日内小时画像'),
  infoText.slice(0, 80).replace(/\n/g, ' '),
)
check('12 右侧不再有统计摘要/时序图', !infoText.includes('统计摘要') && !infoText.includes('流量时间序列'), 'no duplicated stats/series')
const outer = (await infoPane.locator('.ant-tabs-nav').first().locator('.ant-tabs-tab').allInnerTexts()).map((t) => t.trim())
check('13 三个一级 Tab 保留', ['Temporal Analysis', 'Spatial Analysis', 'Multi-City Comparison'].every((t) => outer.includes(t)), outer.join('|'))
const subTabs = await page.locator('.tn-subtabs').count()
const sections = await infoPane.locator('section[aria-label]').evaluateAll((nodes) =>
  nodes.map((node) => node.getAttribute('aria-label')),
)
check(
  '14 二级 Tab 已取消，三个分析段落纵向排列',
  subTabs === 0 && sections.join(',') === 'Hourly Profile,Weekday vs Weekend,ACF & Trend',
  `subtabs=${subTabs} sections=${sections.join('|')}`,
)
await infoPane.locator('.ant-tabs-tab', { hasText: 'Spatial Analysis' }).click()
await page.waitForTimeout(600)
check('14b Spatial Analysis 不显示 Analysis Target', !(await infoPane.innerText()).includes('Analysis Target'), 'target only inside Temporal')
await infoPane.locator('.ant-tabs-tab', { hasText: 'Temporal Analysis' }).click()
await page.waitForTimeout(800)

// ---------------------------------------------------- add a second region ----
await page.locator('[data-field="m1.region_ids"] .ant-select-selector').first().click()
await page.keyboard.type('BRERA', { delay: 40 })
await page.waitForTimeout(500)
await page.keyboard.press('Enter')
await page.keyboard.press('Escape')
await page.waitForTimeout(5000)
const centerAfterAdd = await centerPane.innerText()
const rowCount = await centerPane.locator('table tbody tr').count()
check('15 增加区域后中央统计出现两行', rowCount === 2, `${rowCount} rows`)
check('16 多区域 Insights 出现区域间比较', /平均流量最高的是/.test(centerAfterAdd) && /最低的是/.test(centerAfterAdd), 'comparison insight')

const statsBefore = (await centerPane.locator('table').first().innerText()).replace(/\s+/g, ' ')
const hourlyBefore = await page.locator('section[aria-label="Hourly Profile"] .tn-insight-card').first().innerText()
const targetSelect = page.locator('.tn-analysis-target .ant-select').first()
await targetSelect.click()
await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'BRERA' }).first().click()
await page.waitForTimeout(5000)
const statsAfter = (await centerPane.locator('table').first().innerText()).replace(/\s+/g, ' ')
check(
  '17 切换 Analysis Target 不改变中央统计',
  statsBefore === statsAfter && /BRERA/.test(statsAfter),
  statsAfter.slice(0, 80),
)
const targetValue = await page.locator('.tn-analysis-target .ant-select-selection-item').first().innerText()
check('18 Analysis Target 已切到 BRERA', targetValue.includes('BRERA'), targetValue)

const hourlyAfter = await page.locator('section[aria-label="Hourly Profile"] .tn-insight-card').first().innerText()
check(
  '19 右侧 Insights 随 Analysis Target 重新计算',
  hourlyBefore !== hourlyAfter && hourlyAfter.length > 0,
  `${hourlyBefore.split('\n')[2] ?? ''} → ${hourlyAfter.split('\n')[2] ?? ''}`,
)

// ----------------------------------------------------- subtab + modal ----
const adjacency = []
for (const [label, insight] of [
  ['Hourly Profile', 'Hourly Pattern Insights'],
  ['Weekday vs Weekend', 'Weekday vs Weekend Insights'],
  ['ACF & Trend', 'ACF & Trend Insights'],
]) {
  const section = infoPane.locator(`section[aria-label="${label}"]`)
  const chartCount = await section.locator('.echarts-for-react').count()
  const insightText = await section.locator('.tn-insight-card').count()
  const text = await section.innerText()
  adjacency.push(chartCount >= 1 && insightText === 1 && text.includes(insight))
}
check('20 三组图表+Insights 同页相邻展示', adjacency.every(Boolean), adjacency.join(','))

await page.locator('button:has-text("放大查看")').first().click()
await page.waitForTimeout(900)
const modal = page.locator('.ant-modal-content')
check('21 放大查看打开图表与 Insights', (await modal.isVisible()) && (await modal.locator('.echarts-for-react').count()) >= 1 && (await modal.innerText()).includes('Hourly Pattern Insights'), 'modal ok')
await page.locator('.ant-modal-close').click()
await page.waitForTimeout(400)

// Max Comparison Regions lower than the selection must warn, never silently trim
const maxInput = page.locator('[data-field="m1.max_regions"] input').first()
await maxInput.click({ clickCount: 3 })
await maxInput.fill('1')
await maxInput.press('Tab')
await page.waitForTimeout(2000)
const limitWarning = await page.locator('text=系统不会自动删除已选区域').count()
const limitError = await page.locator('[data-field="m1.region_ids"] .tn-error-text').count()
const runDisabled = await page.locator('button:has-text("运行分析")').first().isDisabled()
const regionChips = await page.locator('[data-field="m1.region_ids"] .ant-select-selection-item').count()
check(
  '25 上限低于已选数量时提示且不自动删除区域',
  limitWarning + limitError > 0 && runDisabled && regionChips === 2,
  `warning=${limitWarning} error=${limitError} chips=${regionChips} runDisabled=${runDisabled}`,
)
await maxInput.click({ clickCount: 3 })
await maxInput.fill('6')
await maxInput.press('Tab')
await page.waitForTimeout(1500)

await page.screenshot({ path: path.join(SHOTS, '20-m1-integrated-1600.png'), fullPage: true })

// --------------------------------------------------------- responsive ----
await page.setViewportSize({ width: 1200, height: 1000 })
await page.waitForTimeout(1200)
const medium = await grid.evaluate((node) => ({
  columns: getComputedStyle(node).gridTemplateColumns,
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  infoSpan: getComputedStyle(node.querySelector('.tn-pane-info')).gridColumn,
}))
check('22 1200px 两栏、右侧整行、无横向溢出', medium.columns.split(' ').length === 2 && medium.infoSpan.startsWith('1 /') && medium.overflow <= 2, `columns=${medium.columns} overflow=${medium.overflow}`)
await page.screenshot({ path: path.join(SHOTS, '21-m1-integrated-1200.png'), fullPage: false })

await page.setViewportSize({ width: 900, height: 1000 })
await page.waitForTimeout(1200)
const narrow = await grid.evaluate((node) => ({
  columns: getComputedStyle(node).gridTemplateColumns,
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
}))
check('23 900px 单栏且无横向溢出', narrow.columns.split(' ').length === 1 && narrow.overflow <= 2, `columns=${narrow.columns} overflow=${narrow.overflow}`)
await page.screenshot({ path: path.join(SHOTS, '22-m1-integrated-900.png'), fullPage: false })

const unexpected = consoleErrors.filter((line) => !line.includes('422'))
check('24 浏览器控制台无未预期错误', unexpected.length === 0, unexpected.slice(0, 2).join(' | '))

// clearing all regions must remove stale right-hand results
await page.setViewportSize({ width: 1600, height: 1200 })
await page.waitForTimeout(600)
await page.locator('button:has-text("清空区域选择")').first().click()
await page.waitForTimeout(1500)
const rightEmpty = await infoPane.innerText()
const insightCount = await page.locator('.tn-insight-card').count()
check(
  '26 清空区域后右侧为空状态且不保留旧结论',
  rightEmpty.includes('请先在左侧选择至少一个有效区域') && insightCount === 0,
  rightEmpty.slice(0, 50).replace(/\n/g, ' ') + ` | insights=${insightCount}`,
)

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} layout checks passed`)
await browser.close()
process.exit(failed ? 1 : 0)
