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

for (const title of ['Hourly Pattern Insights', 'Weekday vs Weekend Insights', 'ACF & Trend Insights']) {
  const card = page.locator(`.tn-insight-card:has-text("${title}")`)
  const count = await card.count()
  const text = count ? await card.first().innerText() : ''
  console.log(`\n[${title}] present=${count > 0}`)
  console.log(text.split('\n').slice(0, 12).join('\n'))
}

// Advanced Settings must be gone from the UI (index parameters stay internal)
const advancedEntry = await page.locator('text=Advanced Settings').count()
const indexInputs = await page.locator('[data-field="m1.start_index"] input, [data-field="m1.window_points"] input').count()
console.log(`\nadvanced settings entry: ${advancedEntry}, visible index inputs: ${indexInputs}`)

// change the END date via the picker (still after the start) and verify the range follows
const endInput = page.locator('[data-field="m1.time_end"] input').first()
await endInput.click()
await endInput.fill('2013-11-14 23:50')
await page.keyboard.press('Enter')
await page.waitForTimeout(6000)
const summaryAfter = await page.locator('.tn-range-summary').first().innerText()
console.log('after end-date change:', summaryAfter.split('\n').slice(0, 4).join(' | '))

const hourlyAfter = await page.locator('.tn-insight-card:has-text("Hourly Pattern Insights")').first().innerText()
console.log('\nhourly insight after change:', hourlyAfter.split('\n').slice(0, 4).join(' / '))

// move the start date and confirm the analysis follows (central stats update)
const startInput2 = page.locator('[data-field="m1.time_start"] input').first()
await startInput2.click()
await startInput2.fill('2013-11-09 00:00')
await page.keyboard.press('Enter')
await page.waitForTimeout(6000)
const summaryMoved = await page.locator('.tn-range-summary').first().innerText()
console.log('\nafter start-date change:', summaryMoved.split('\n').slice(0, 3).join(' | '))

await page.screenshot({ path: path.join(SHOTS, '12-m1-insights.png'), fullPage: true })
await page.setViewportSize({ width: 1600, height: 2400 })
await page.waitForTimeout(500)
await page.screenshot({ path: path.join(SHOTS, '13-m1-insights-full.png'), fullPage: true })

console.log('\nconsole errors:', errors.length ? errors.slice(0, 3) : 'none')
await browser.close()
