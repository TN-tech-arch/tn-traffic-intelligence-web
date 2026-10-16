import { chromium } from 'playwright'

const B = await chromium.launch({ headless: true })
const page = await B.newPage({ viewport: { width: 1600, height: 1000 } })
await page.goto('http://127.0.0.1:8077/training', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

const header = page.locator('.ant-collapse-header', { hasText: '深度学习' }).first()
if ((await header.getAttribute('aria-expanded')) !== 'true') {
  await header.click()
  await page.waitForTimeout(600)
}
await page.locator('.tn-pane div[role="button"]', { hasText: 'LSTM' }).first().click()
await page.waitForTimeout(2000)

console.log('errors:', JSON.stringify(await page.locator('.tn-error-text').allInnerTexts()))
console.log('warnings:', JSON.stringify(await page.locator('.tn-warning-text').allInnerTexts()))
console.log('dataset select:', (await page.locator('.tn-pane .ant-select-selector').first().innerText()).replace(/\n/g, ' '))
console.log('run disabled:', await page.locator('button:has-text("Run Training")').first().isDisabled())
const fields = await page.locator('.tn-pane [data-field]').evaluateAll((nodes) =>
  nodes.map((n) => `${n.getAttribute('data-field')}=${n.querySelector('input')?.value ?? ''}`),
)
console.log('fields:', fields.join(' | '))
const buttons = await page.locator('.tn-pane button').evaluateAll((nodes) =>
  nodes.map((n) => `${(n.textContent ?? '').trim()} disabled=${n.disabled}`),
)
console.log('buttons:', buttons.join(' | '))
const issues = await page.evaluate(() => {
  const node = document.querySelector('[data-field="m3.input_length"]')
  return node ? node.outerHTML.slice(0, 120) : 'no node'
})
console.log('probe:', issues)
const debug = await page.locator('[data-testid="run-training"]').first().evaluate((n) => ({
  runnable: n.getAttribute('data-runnable'),
  dataset: n.getAttribute('data-dataset'),
  errors: n.getAttribute('data-errors'),
}))
console.log('debug:', JSON.stringify(debug))
await B.close()
