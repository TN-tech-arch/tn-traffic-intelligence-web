/** Module 2-5 left history panels share the same visual structure. */

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.TN_UI_BASE ?? 'http://127.0.0.1:8077'
const SHOTS = path.resolve('..', 'data', 'screenshots')
fs.mkdirSync(SHOTS, { recursive: true })

const modules = [
  { key: 'm2', route: 'clustering', testId: 'm2-cluster-history' },
  { key: 'm3', route: 'dataset', testId: 'm3-dataset-history' },
  { key: 'm4', route: 'training', testId: 'm4-experiment-history' },
  { key: 'm5', route: 'evaluation', testId: 'm5-history' },
]

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1680, height: 1100 } })
const results = []

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`)
}

try {
  const styles = []
  for (const module of modules) {
    await page.goto(`${BASE}/${module.route}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    const panel = page.getByTestId(module.testId)
    await panel.waitFor({ state: 'visible', timeout: 60000 })
    await panel.locator('.tn-history-item, .tn-empty').first().waitFor({ state: 'visible', timeout: 30000 })
    const items = panel.locator('.tn-history-item')
    const count = await items.count()
    if (!count) {
      check(
        `${module.key} uses the shared history card shell`,
        (await panel.locator('.ant-card-head-title').count()) === 1,
        'empty history',
      )
      await panel.screenshot({
        path: path.join(SHOTS, `history-unified-${module.key}.png`),
        animations: 'disabled',
      })
      continue
    }
    await items.first().waitFor({ state: 'visible', timeout: 30000 })
    const first = items.first()
    const metaCount = await first.locator('.tn-history-meta > span').count()
    const actionLabels = await first.locator('.tn-history-actions button').allInnerTexts()
    const normalizedActions = actionLabels.map((label) => label.replace(/\s+/g, ''))
    const style = await first.evaluate((node) => {
      const computed = getComputedStyle(node)
      return {
        background: computed.backgroundColor,
        border: computed.borderColor,
        radius: computed.borderRadius,
        padding: computed.padding,
      }
    })
    styles.push(style)
    check(
      `${module.key} uses the shared compact history card`,
      count > 0 &&
        count <= 6 &&
        (await first.locator('.tn-history-id').count()) === 1 &&
        (await first.locator('.ant-tag').count()) >= 1 &&
        metaCount >= 3 &&
        actionLabels.length === 2 &&
        normalizedActions[0].includes('打开') &&
        normalizedActions[1].includes('删除记录'),
      `items=${count}; meta=${metaCount}; actions=${actionLabels.join(' | ')}`,
    )
    await panel.screenshot({
      path: path.join(SHOTS, `history-unified-${module.key}.png`),
      animations: 'disabled',
    })
  }
  check(
    'all four modules use identical history item colors, borders, radius and padding',
    styles.length > 0 && styles.every((style) => JSON.stringify(style) === JSON.stringify(styles[0])),
    JSON.stringify(styles),
  )
} finally {
  await browser.close()
}

const failed = results.filter((result) => !result.ok).length
fs.writeFileSync(
  path.join(SHOTS, 'history-unified-results.json'),
  JSON.stringify({ base: BASE, results }, null, 2),
)
console.log(`\n${results.length - failed}/${results.length} unified history checks passed`)
process.exit(failed ? 1 : 0)
