import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
page.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0, 300)))
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)))
page.on('request', (r) => {
  if (r.url().includes('/api/analysis')) console.log('REQ', r.method(), r.url(), r.postData()?.slice(0, 300))
})
page.on('response', async (r) => {
  if (r.url().includes('/api/analysis')) {
    console.log('RES', r.status(), r.url(), (await r.text()).slice(0, 400))
  }
  if (r.url().includes('/api/validation/check')) {
    console.log('VALIDATION', r.status(), (await r.text()).slice(0, 900))
  }
})

await page.goto('http://127.0.0.1:8077/exploration', { waitUntil: 'networkidle' })
await page.waitForTimeout(6000)
console.log('toasts:', await page.locator('.ant-message-notice-content').allInnerTexts())
console.log('errors:', await page.locator('.tn-error-text').allInnerTexts())
console.log('warnings:', await page.locator('.tn-warning-text').allInnerTexts())
console.log('alerts:', await page.locator('.ant-alert-message').allInnerTexts())
const regionSelect = await page.locator('[data-field="m1.region_ids"] .ant-select-selection-item').allInnerTexts()
console.log('selected regions:', regionSelect)
await browser.close()
