import { chromium } from 'playwright'

const b = await chromium.launch({ headless: true })
const p = await b.newPage({ viewport: { width: 1600, height: 1200 } })
await p.goto('http://127.0.0.1:8077/exploration', { waitUntil: 'networkidle' })
await p.waitForTimeout(5000)
console.log('hints:', await p.locator('.tn-hint').count())
console.log('labels prefix:', await p.locator('[aria-label^="时间截面"]').count())
const labels = await p.locator('[aria-label]').evaluateAll((nodes) =>
  nodes.map((n) => n.getAttribute('aria-label')).filter((l) => l && l.includes('时间截面')),
)
console.log('labels:', JSON.stringify(labels))
await b.close()
