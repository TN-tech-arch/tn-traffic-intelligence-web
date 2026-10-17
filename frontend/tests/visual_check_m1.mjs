/**
 * Visual check for the Module 1 feedback round:
 *  - region names visible on the map
 *  - weekly pattern has all seven days
 *  - multi-city chart really plots the z-score values
 *  - the explanation blocks are present
 */

import { chromium } from 'playwright'
import path from 'node:path'

const BASE = 'http://127.0.0.1:8077'
const SHOTS = path.resolve('..', 'data', 'screenshots')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
await page.goto(`${BASE}/exploration`, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)

const labels = await page.locator('.tn-map-label').count()
console.log('map labels:', labels)

const watermark = await page.evaluate(() => document.body.innerText.includes('API KEY REQUIRED'))
console.log('carto watermark present:', watermark)

// weekly chart: read echarts option through the DOM is not trivial; assert the API data instead
const weekly = await page.evaluate(async () => {
  const response = await fetch('/api/analysis/temporal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_key: 'milano', region_ids: ['ADRIANO'], frequency: 'native', aggregation: 'mean',
      start_index: 0, window_points: 1008, max_regions: 6,
    }),
  })
  const data = await response.json()
  return {
    weekly: data.weekly_profiles?.[0]?.weekly_mean,
    note: data.weekly_note,
    points: data.total_points,
  }
})
console.log('weekly means:', JSON.stringify(weekly.weekly))
console.log('weekly note:', weekly.note)
const nonNull = (weekly.weekly ?? []).filter((v) => v !== null).length
console.log('weekly non-null days:', nonNull)

const compare = await page.evaluate(async () => {
  const response = await fetch('/api/analysis/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_keys: ['milano', 'trentino', 'zte'], frequency: '60min', aggregation: 'mean' }),
  })
  const data = await response.json()
  return data.sources.map((s) => ({ name: s.display_name, z: s.hourly_shape_z, raw: s.hourly_shape }))
})
for (const item of compare) {
  const zValues = item.z.filter((v) => v !== null)
  const rawValues = item.raw.filter((v) => v !== null)
  console.log(
    `${item.name}: z range ${Math.min(...zValues).toFixed(2)}..${Math.max(...zValues).toFixed(2)} ` +
      `| raw max ${Math.max(...rawValues).toExponential(2)}`,
  )
}

await page.locator('.ant-tabs-tab', { hasText: 'Multi-City Comparison' }).first().click()
await page.waitForTimeout(1200)
await page.screenshot({ path: path.join(SHOTS, '10-m1-map-labels-and-explain.png'), fullPage: false })
await page.locator('.ant-tabs-tab', { hasText: 'Temporal Analysis' }).first().click()
await page.waitForTimeout(800)
await page.screenshot({ path: path.join(SHOTS, '11-m1-explanations.png'), fullPage: false })
await browser.close()
console.log('screenshots written')
