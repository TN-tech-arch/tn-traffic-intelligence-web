import { chromium } from 'playwright'
import path from 'node:path'

const BASE = 'http://127.0.0.1:8077'
const SHOTS = path.resolve('..', 'data', 'screenshots')
const suffix = process.argv[2] || 'before'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } })

async function shot(locator, name) {
  await locator.scrollIntoViewIfNeeded()
  await page.waitForTimeout(350)
  await locator.screenshot({ path: path.join(SHOTS, `chart-axis-${suffix}-${name}.png`) })
}

await page.goto(`${BASE}/exploration`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
const center = page.locator('.tn-three-pane > section').nth(1)
await shot(
  center.locator('.ant-card').filter({ hasText: '多区域时序曲线' }).first(),
  'm1-time-series',
)
const info = page.locator('.tn-three-pane > section').nth(2)

for (const [section, name] of [
  ['Hourly Profile', 'm1-hourly'],
  ['Weekday vs Weekend', 'm1-weekday'],
  ['ACF & Trend', 'm1-acf'],
]) {
  await shot(info.locator(`section[aria-label="${section}"]`), name)
}
await page.setViewportSize({ width: 1200, height: 1000 })
await page.waitForTimeout(700)
await shot(info.locator('section[aria-label="Hourly Profile"]'), 'm1-hourly-1200')
await page.setViewportSize({ width: 900, height: 1000 })
await page.waitForTimeout(700)
await shot(info.locator('section[aria-label="Hourly Profile"]'), 'm1-hourly-900')
await page.setViewportSize({ width: 1600, height: 1400 })
await page.waitForTimeout(700)

await info.locator('.ant-tabs-tab').filter({ hasText: 'Spatial Analysis' }).click()
await page.waitForTimeout(1000)
await shot(info.locator('section[aria-label="Top 12 Regions"]'), 'm1-spatial-top')
await shot(info.locator('section[aria-label="Bottom 6 Regions"]'), 'm1-spatial-bottom')
await shot(info.locator('section[aria-label="Regional Value Distribution"]'), 'm1-spatial-distribution')

await info.locator('.ant-tabs-tab').filter({ hasText: 'Multi-City Comparison' }).click()
await info.locator('[data-testid="m1-multicity-z-chart"]').waitFor({
  state: 'visible',
  timeout: 60000,
})
await page.waitForTimeout(1200)
await shot(info.locator('.ant-tabs-tabpane-active'), 'm1-multicity')

await page.goto(`${BASE}/clustering`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const history = page
  .locator('.tn-history-row')
  .filter({ hasText: /CLUS-MILANO-KMEANS-/ })
  .first()
await history.waitFor({ state: 'visible', timeout: 30000 })
const open = history.locator('button').filter({ hasText: /打\s*开/ }).first()
if (await open.count()) {
  await open.click()
  await page.getByText(/最近运行 CLUS-MILANO-KMEANS-/).first().waitFor({
    state: 'visible',
    timeout: 60000,
  })
  await page.waitForTimeout(900)
}
const clusterInfo = page.locator('.tn-three-pane > section').nth(2)
await clusterInfo.locator('.ant-tabs-tab').filter({ hasText: '典型模式' }).click()
await page.getByText('各簇平均日内模式', { exact: false }).first().waitFor({
  state: 'visible',
  timeout: 60000,
})
await page.waitForTimeout(900)
await shot(clusterInfo.locator('.ant-tabs-tabpane-active'), 'm2-typical-weekly')
const weeklyCard = clusterInfo.locator('.ant-card').filter({ hasText: '周内差异' }).first()
if (await weeklyCard.locator('.ant-switch').count()) {
  await weeklyCard.locator('.ant-switch').click()
  await page.waitForTimeout(700)
  await shot(weeklyCard, 'm2-weekly-raw')
}

await page.setViewportSize({ width: 1200, height: 1000 })
await page.waitForTimeout(900)
await shot(clusterInfo.locator('.ant-tabs-tabpane-active'), 'm2-typical-weekly-1200')

await browser.close()
