/**
 * Spatial Analysis verification:
 * all-region scope, Top 12 -> Bottom 6 -> Distribution order, insights,
 * map focus on bar click, time-slice synchronisation and enlarge modal.
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
page.on('pageerror', (e) => consoleErrors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

await page.goto(`${BASE}/exploration`, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)

const infoPane = page.locator('.tn-three-pane > section').nth(2)
await infoPane.locator('.ant-tabs-tab', { hasText: 'Spatial Analysis' }).click()
await page.waitForTimeout(1500)

const panel = infoPane.locator('.ant-tabs-tabpane-active')
const headerText = await panel.innerText()
check('1 显示当前截面与有效区域数', /有效区域 88/.test(headerText) && /当前截面 2013-11-01 00:00:00/.test(headerText), headerText.split('\n')[0])

const sections = await panel.locator('section[aria-label]').evaluateAll((nodes) =>
  nodes.map((n) => n.getAttribute('aria-label')),
)
check(
  '2 图表顺序 Top 12 → Bottom 6 → Distribution',
  sections.join(',') === 'Top 12 Regions,Bottom 6 Regions,Regional Value Distribution',
  sections.join('|'),
)

const charts = panel.locator('.echarts-for-react')
check('3 三张空间图都在当前页面', (await charts.count()) === 3, `${await charts.count()} charts`)

const insightTitles = await panel.locator('.tn-insight-card').evaluateAll((nodes) =>
  nodes.map((n) => n.innerText.split('\n')[0]),
)
check(
  '4 三组 Insights 与图表相邻',
  insightTitles.some((t) => t.includes('High-Intensity')) &&
    insightTitles.some((t) => t.includes('Low-Intensity')) &&
    insightTitles.some((t) => t.includes('Spatial Distribution')),
  insightTitles.join('|'),
)

const highText = await panel.locator('section[aria-label="Top 12 Regions"] .tn-insight-card').innerText()
check('5 高流量 Insights 使用真实最高区域', /流量最高的是 [A-Z]/.test(highText) && /源单位/.test(highText), highText.split('\n')[2] ?? '')

// all-region scope is independent from the left selection
const beforeTop = highText
await page.locator('[data-field="m1.region_ids"] .ant-select-selector').click()
await page.keyboard.type('BRERA', { delay: 35 })
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.keyboard.press('Escape')
await page.waitForTimeout(5000)
const afterText = await panel.innerText()
check('6 改变左侧区域选择不影响空间统计范围', /有效区域 88/.test(afterText), 'still 88 regions')

// click the first bar -> map focus text
const topChart = panel.locator('section[aria-label="Top 12 Regions"] .echarts-for-react').first()
const box = await topChart.boundingBox()
await page.mouse.click(box.x + box.width * 0.45, box.y + 22)
await page.waitForTimeout(900)
const focusText = await panel.innerText()
check('7 点击排名条形可在中央地图定位', /地图已定位 [A-Z]/.test(focusText), (focusText.match(/地图已定位 \S+/) ?? [''])[0])

// time slice change updates rankings/insights
const beforeSlice = await panel.locator('section[aria-label="Top 12 Regions"] .tn-insight-card').innerText()
const slider = page.locator('input[type="range"]').first()
await slider.fill(await slider.getAttribute('max'))
await page.waitForTimeout(4000)
const afterSlice = await panel.locator('section[aria-label="Top 12 Regions"] .tn-insight-card').innerText()
check('8 时间截面改变后排名与 Insights 更新', beforeSlice !== afterSlice, `${beforeSlice.split('\n')[2]?.slice(0, 50)} → ${afterSlice.split('\n')[2]?.slice(0, 50)}`)

// enlarge modal
await panel.locator('section[aria-label="Top 12 Regions"] button:has-text("放大查看")').click()
await page.waitForTimeout(800)
const modal = page.locator('.ant-modal-content')
check('9 放大查看可用', (await modal.isVisible()) && (await modal.innerText()).includes('High-Intensity'), 'modal ok')
await page.locator('.ant-modal-close').click()
await page.waitForTimeout(400)

await page.screenshot({ path: path.join(SHOTS, '32-m1-spatial-analysis.png'), fullPage: true })
check('10 控制台无未预期错误', consoleErrors.filter((e) => !e.includes('422')).length === 0, consoleErrors.slice(0, 2).join(' | '))

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} spatial checks passed`)
await browser.close()
process.exit(failed ? 1 : 0)
