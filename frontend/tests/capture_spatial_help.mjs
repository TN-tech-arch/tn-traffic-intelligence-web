import { chromium } from 'playwright'
import path from 'node:path'

const BASE = 'http://127.0.0.1:8077'
const SHOTS = path.resolve('..', 'data', 'screenshots')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } })
await page.goto(`${BASE}/exploration`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
await page.locator('.ant-tabs-tab', { hasText: '空间分析' }).first().click()
await page.waitForTimeout(1200)
await page.locator('section[aria-label="Top 12 Regions"] .tn-help-trigger').first().hover()
await page.waitForTimeout(500)
await page.screenshot({ path: path.join(SHOTS, '33-m1-spatial-help.png') })
await browser.close()
console.log('saved')
