/**
 * Module 1 layout verification:
 *  - 25% / 40% / 35% columns on wide screens
 *  - Statistical Summary stays fixed above three secondary tabs
 *  - the duplicate Traffic Time Series is gone from the right pane
 *  - each secondary tab renders its chart + insights, and "放大查看" opens a modal
 *  - narrow viewports collapse without horizontal overflow
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
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

await page.goto(`${BASE}/exploration`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)

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

const centerPane = page.locator('.tn-three-pane > section').nth(1)
const infoPane = page.locator('.tn-three-pane > section').nth(2)
const infoText = await infoPane.innerText()
const centerText = await centerPane.innerText()
check('2 右侧顶部固定显示统计摘要', infoText.indexOf('统计摘要') >= 0 && infoText.indexOf('统计摘要') < infoText.indexOf('Hourly Profile'), 'summary before tabs')
check('3 右侧不再包含重复的时间序列图', !infoText.includes('流量时间序列'), 'no duplicate series in info pane')
check('4 中央保留多区域时序曲线', centerText.includes('多区域时序曲线'), 'center keeps the series chart')
check('5 中央地图/图例/滑块仍在', (await centerPane.locator('.leaflet-container').count()) === 1 && centerText.includes('No Data') && centerText.includes('时间截面位置'), 'map + legend + slider')

const subTabLabels = (await page.locator('.tn-subtabs .ant-tabs-tab').allInnerTexts()).map((t) => t.trim())
check(
  '6 三个二级 Tab 齐全（纵向堆叠已取消）',
  subTabLabels.join(',') === 'Hourly Profile,Weekday vs Weekend,ACF & Trend',
  subTabLabels.join('|'),
)

// switching tabs shows exactly one chart section at a time
const tabCheck = []
for (const [label, insight] of [
  ['Hourly Profile', 'Hourly Pattern Insights'],
  ['Weekday vs Weekend', 'Weekday vs Weekend Insights'],
  ['ACF & Trend', 'ACF & Trend Insights'],
]) {
  await page.locator('.tn-subtabs .ant-tabs-tab', { hasText: label }).first().click()
  await page.waitForTimeout(800)
  const visibleInsights = await page.locator('.tn-insight-card:visible').allInnerTexts()
  const visibleCharts = await page.locator('.tn-subtabs .echarts-for-react:visible').count()
  tabCheck.push(visibleInsights.length === 1 && visibleInsights[0].includes(insight) && visibleCharts === 1)
}
check('7 每个二级 Tab 只显示自己的图表 + Insights', tabCheck.every(Boolean), tabCheck.join(','))

// enlarge modal
await page.locator('.tn-subtabs .ant-tabs-tab', { hasText: 'Hourly Profile' }).first().click()
await page.waitForTimeout(500)
await page.locator('button:has-text("放大查看")').first().click()
await page.waitForTimeout(900)
const modal = page.locator('.ant-modal-content')
const modalVisible = await modal.isVisible()
const modalHasChart = (await modal.locator('.echarts-for-react').count()) >= 1
const modalHasInsight = (await modal.innerText()).includes('Hourly Pattern Insights')
check('8 放大查看打开模态框并保留图表与结论', modalVisible && modalHasChart && modalHasInsight, `visible=${modalVisible} chart=${modalHasChart}`)
await page.screenshot({ path: path.join(SHOTS, '15-m1-layout-modal.png'), fullPage: false })
await page.locator('.ant-modal-close').click()
await page.waitForTimeout(500)
check('9 关闭放大视图', !(await modal.isVisible()), 'modal closed')

await page.screenshot({ path: path.join(SHOTS, '16-m1-layout-1600.png'), fullPage: true })

// responsive: 1200 → two columns, info below; no horizontal overflow
await page.setViewportSize({ width: 1200, height: 1000 })
await page.waitForTimeout(1200)
const medium = await grid.evaluate((node) => ({
  columns: getComputedStyle(node).gridTemplateColumns,
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  infoSpan: getComputedStyle(node.querySelector('.tn-pane-info')).gridColumn,
}))
check('10 1200px 下折叠为两栏且右侧整行', medium.columns.split(' ').length === 2 && medium.infoSpan.startsWith('1 /'), `columns=${medium.columns} span=${medium.infoSpan}`)
check('11 1200px 下无横向溢出', medium.overflow <= 2, `overflow=${medium.overflow}px`)
await page.screenshot({ path: path.join(SHOTS, '17-m1-layout-1200.png'), fullPage: false })

await page.setViewportSize({ width: 900, height: 1000 })
await page.waitForTimeout(1200)
const narrow = await grid.evaluate((node) => ({
  columns: getComputedStyle(node).gridTemplateColumns,
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
}))
check('12 900px 下折叠为单栏且无横向溢出', narrow.columns.split(' ').length === 1 && narrow.overflow <= 2, `columns=${narrow.columns} overflow=${narrow.overflow}`)
await page.screenshot({ path: path.join(SHOTS, '18-m1-layout-900.png'), fullPage: false })

const unexpected = consoleErrors.filter((line) => !line.includes('422'))
check('13 浏览器控制台无未预期错误', unexpected.length === 0, unexpected.slice(0, 2).join(' | '))

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} layout checks passed`)
await browser.close()
process.exit(failed ? 1 : 0)
