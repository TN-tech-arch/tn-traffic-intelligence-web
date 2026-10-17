/**
 * Browser verification for the Module 1 rebuild:
 * date range pickers, synced advanced indices, and the three insight cards.
 */

import { chromium } from 'playwright'
import path from 'node:path'

const BASE = 'http://127.0.0.1:8077'
const SHOTS = path.resolve('..', 'data', 'screenshots')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(`${BASE}/exploration`, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)

const dateInputs = await page.locator('[data-field="m1.time_start"] input, [data-field="m1.time_end"] input').count()
console.log('date inputs:', dateInputs)

const summary = await page.locator('.tn-range-summary').first().innerText()
console.log('range summary:', summary.replace(/\n/g, ' | '))

const subTabByInsight = {
  'Hourly Pattern Insights': 'Hourly Profile',
  'Weekday vs Weekend Insights': 'Weekday vs Weekend',
  'ACF & Trend Insights': 'ACF & Trend',
}
for (const title of Object.keys(subTabByInsight)) {
  await page.locator('.tn-subtabs .ant-tabs-tab', { hasText: subTabByInsight[title] }).first().click()
  await page.waitForTimeout(600)
  const card = page.locator(`.tn-insight-card:has-text("${title}")`)
  const count = await card.count()
  const text = count ? await card.first().innerText() : ''
  console.log(`\n[${title}] present=${count > 0}`)
  console.log(text.split('\n').slice(0, 12).join('\n'))
}

// advanced indexes exist and are synced with the dates
await page.locator('.ant-collapse-header:has-text("Advanced Settings")').first().click()
await page.waitForTimeout(600)
const startIndex = await page.locator('[data-field="m1.start_index"] input').inputValue()
const windowPoints = await page.locator('[data-field="m1.window_points"] input').inputValue()
console.log(`\nadvanced indices: start=${startIndex} points=${windowPoints}`)

// change the END date via the picker (still after the start) and verify the range follows
const endInput = page.locator('[data-field="m1.time_end"] input').first()
await endInput.click()
await endInput.fill('2013-11-14 23:50')
await page.keyboard.press('Enter')
await page.waitForTimeout(6000)
const summaryAfter = await page.locator('.tn-range-summary').first().innerText()
const startAfter = await page.locator('[data-field="m1.start_index"] input').inputValue()
console.log('after end-date change:', summaryAfter.split('\n').slice(0, 4).join(' | '), '| start_index =', startAfter)

const hourlyAfter = await page.locator('.tn-insight-card:has-text("Hourly Pattern Insights")').first().innerText()
console.log('\nhourly insight after change:', hourlyAfter.split('\n').slice(0, 4).join(' / '))

// change the advanced index and verify the dates are converted back
const indexInput = page.locator('[data-field="m1.start_index"] input').first()
await indexInput.click({ clickCount: 3 })
await indexInput.fill('144')
await page.keyboard.press('Tab')
await page.waitForTimeout(6000)
const startDateAfterIndex = await page.locator('[data-field="m1.time_start"] input').first().inputValue()
console.log('\nafter index=144 -> start date:', startDateAfterIndex)

await page.screenshot({ path: path.join(SHOTS, '12-m1-insights.png'), fullPage: true })
await page.setViewportSize({ width: 1600, height: 2400 })
await page.waitForTimeout(500)
await page.screenshot({ path: path.join(SHOTS, '13-m1-insights-full.png'), fullPage: true })

console.log('\nconsole errors:', errors.length ? errors.slice(0, 3) : 'none')
await browser.close()
