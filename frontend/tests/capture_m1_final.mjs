import { chromium } from 'playwright'
import path from 'node:path'

const BASE = 'http://127.0.0.1:8077'
const SHOTS = path.resolve('..', 'data', 'screenshots')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1300 } })
await page.goto(`${BASE}/exploration`, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)

async function addRegion(id) {
  await page.locator('[data-field="m1.region_ids"] .ant-select-selector').first().click()
  await page.keyboard.type(id, { delay: 35 })
  await page.waitForTimeout(350)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(4500)
}

await addRegion('BRERA')
await addRegion('DUOMO')

const pane = (index) => page.locator('.tn-three-pane > section').nth(index)
await pane(0).screenshot({ path: path.join(SHOTS, '23-m1-left-config.png') })
await pane(1).screenshot({ path: path.join(SHOTS, '24-m1-center-multi-region.png') })

await pane(2).screenshot({ path: path.join(SHOTS, '25-m1-right-temporal-stacked.png') })

await page.screenshot({ path: path.join(SHOTS, '28-m1-integrated-full.png'), fullPage: true })
console.log('screenshots written')
await browser.close()
