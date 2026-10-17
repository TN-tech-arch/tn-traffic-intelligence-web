/**
 * Multi-City Comparison regression:
 * sample-count labels, Z-score chart, single warning, dynamic insights,
 * compact source summary, dark help tooltip and enlarge modal.
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

await page.goto(`${BASE}/exploration`, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)

const infoPane = page.locator('.tn-three-pane > section').nth(2)
await infoPane.locator('.ant-tabs-tab', { hasText: 'Multi-City Comparison' }).click()
await page.waitForTimeout(2500)
const panel = infoPane.locator('.ant-tabs-tabpane-active')
const text = await panel.innerText()

check(
  '1 只保留一条紧凑的时期/单位警告',
  (await panel.locator('.ant-alert-warning').count()) === 1 &&
    text.includes('原始值不可直接比较') &&
    text.includes('ZTE 为 4G 下行流量，不是道路车辆流量'),
  `${await panel.locator('.ant-alert-warning').count()} warning`,
)
check('2 不再出现歧义的“1488 点 @ 10 分钟”', !/1488 点\s*@/.test(text), 'ambiguous label removed')

const api = await page.evaluate(async () => {
  const response = await fetch('/api/analysis/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_keys: ['milano', 'trentino', 'zte'],
      frequency: '60min',
      aggregation: 'mean',
    }),
  })
  return response.json()
})
const byKey = Object.fromEntries(api.sources.map((source) => [source.source_key, source]))
check(
  '3 API 区分原始点、有效观测与小时桶',
  byKey.milano.raw_time_point_count === 8928 &&
    byKey.milano.hourly_bucket_count === 1488 &&
    byKey.zte.raw_time_point_count === 2784 &&
    byKey.zte.hourly_bucket_count === 696 &&
    api.sources.every((source) => source.hourly_profile_points === 24),
  api.sources
    .map((source) => `${source.source_key}:${source.raw_time_point_count}/${source.hourly_bucket_count}/24`)
    .join(' '),
)
check(
  '4 摘要表真实显示三类口径和有效样本',
  text.includes('原始 8,928 个时间点 · 间隔 10 分钟') &&
    text.includes('小时聚合 1,488 个') &&
    text.includes('原始 2,784 个时间点 · 间隔 15 分钟') &&
    text.includes('小时聚合 696 个') &&
    text.includes('有效原始观测（区域×时间） 785,664'),
  'counts rendered',
)

const chart = panel.locator('[data-testid="m1-multicity-z-chart"]')
check(
  '5 24 小时 Z-score 图存在且没有 DataZoom',
  (await chart.count()) === 1 &&
    (await chart.first().getAttribute('data-datazoom')) === 'none' &&
    (await chart.locator('canvas').count()) >= 1,
  `charts=${await chart.count()}`,
)
check(
  '6 三条曲线和 Z=0 说明可见',
  text.includes('Milano') && text.includes('Trentino') && text.includes('ZTE 4G Downlink') && text.includes('Z=0'),
  'legend and zero reference',
)
const chartBox = await chart.first().boundingBox()
await page.mouse.move(
  chartBox.x + chartBox.width * 0.58,
  chartBox.y + chartBox.height * 0.45,
)
await page.waitForTimeout(500)
const chartTooltip = await chart.first().evaluate((root) => {
  const nodes = Array.from(root.querySelectorAll('div')).filter(
    (node) =>
      getComputedStyle(node).position === 'absolute' &&
      node.textContent?.includes('Z=0 为该来源自身的典型小时平均水平'),
  )
  return nodes.at(-1)?.textContent ?? ''
})
check(
  '6b Tooltip 显示小时和三个来源的真实 Z-score',
  chartTooltip.includes('Milano') &&
    chartTooltip.includes('Trentino') &&
    chartTooltip.includes('ZTE 4G Downlink') &&
    /-?\d+\.\d{3}/.test(chartTooltip),
  chartTooltip.replace(/\s+/g, ' ').slice(0, 90),
)

const insightCard = panel.locator('.tn-insight-card').filter({ hasText: 'Multi-City Comparison Insights' })
const insightText = await insightCard.innerText()
check(
  '7 Multi-City Insights 紧跟图表并含四类真实结论',
  (await insightCard.count()) === 1 &&
    ['典型高峰', '典型低谷', '形状相似性', '时段差异与波动'].every((label) => insightText.includes(label)),
  insightText.split('\n').slice(0, 4).join(' | '),
)
check(
  '8 Insights 使用真实相似性结果并说明限制',
  insightText.includes('Milano–Trentino') &&
    insightText.includes('r=0.987') &&
    insightText.includes('不代表同步观测') &&
    !text.includes('三个来源分别占据大卡片'),
  'dynamic r and limits',
)
const detailsToggle = insightCard.getByText('展开详情 / 统计依据')
await detailsToggle.click()
await page.waitForTimeout(300)
check(
  '9 详情可展开并显示样本口径',
  (await insightCard.innerText()).includes('原始 8928 个时间点') &&
    (await insightCard.innerText()).includes('CV 口径'),
  'details expanded',
)

const summary = panel.locator('.ant-card').filter({ hasText: 'Dataset Comparison Summary' })
check(
  '10 三个大来源卡片已替换为一张紧凑摘要表',
  (await summary.count()) === 1 &&
    (await summary.locator('tbody tr').count()) === 3 &&
    (await summary.locator('.ant-table').count()) === 1,
  `rows=${await summary.locator('tbody tr').count()}`,
)
check(
  '11 CV 明确标注为 24 点典型曲线口径',
  (await summary.innerText()).includes('CV（24 点典型值）') &&
    (await summary.innerText()).includes('0.303') &&
    (await summary.innerText()).includes('0.425'),
  'CV basis visible',
)

const chartHelp = panel.locator('.ant-card').filter({ hasText: '标准化日内模式对比' }).locator('.tn-help-trigger').first()
await chartHelp.hover()
await page.waitForTimeout(450)
const tip = page.locator('.tn-help-tooltip:visible .ant-tooltip-inner')
const tipText = (await tip.count()) ? await tip.first().innerText() : ''
const tipBackground = (await tip.count()) ? await tip.first().evaluate((node) => getComputedStyle(node).backgroundColor) : ''
check(
  '12 方法说明使用黑底悬停 Tooltip',
  tipText.includes('24 点典型曲线') && tipBackground === 'rgb(31, 36, 48)',
  `${tipBackground} | ${tipText.slice(0, 45)}`,
)
await page.mouse.move(1500, 1200)
await page.waitForTimeout(250)

await panel.getByRole('button', { name: '放大查看' }).click()
await page.waitForTimeout(700)
const modal = page.locator('.ant-modal-content')
check(
  '13 放大查看保留图表与 Insights',
  (await modal.isVisible()) &&
    (await modal.locator('[data-testid="m1-multicity-z-chart"]').count()) === 1 &&
    (await modal.locator('.tn-insight-card').count()) === 1,
  'modal content complete',
)
await page.locator('.ant-modal-close').click()
await page.waitForTimeout(300)

check(
  '14 浏览器控制台无未预期错误',
  consoleErrors.length === 0,
  consoleErrors.slice(0, 2).join(' | '),
)

await page.screenshot({ path: path.join(SHOTS, '33-m1-multicity-comparison.png'), fullPage: true })
await panel.screenshot({ path: path.join(SHOTS, '34-m1-multicity-panel.png') })

const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} multi-city checks passed`)
await browser.close()
process.exit(failed ? 1 : 0)
