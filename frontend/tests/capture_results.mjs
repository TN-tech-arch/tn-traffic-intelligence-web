/**
 * Capture evidence screenshots with real results loaded:
 * 1. run a real clustering (Milano, K-Means) and open it in Module 2
 * 2. open the latest completed evaluation in Module 5
 */

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.TN_UI_BASE ?? 'http://127.0.0.1:8077'
const SHOTS = path.resolve('..', 'data', 'screenshots')
fs.mkdirSync(SHOTS, { recursive: true })

const config = {
  source_key: 'milano',
  frequency: '60min',
  aggregation: 'mean',
  start_index: 0,
  window_points: 1008,
  features: ['mean', 'std', 'cv', 'intraday_peak_ratio', 'day_night_ratio', 'weekday_weekend_ratio', 'daily_seasonality'],
  standardize: true,
  algorithm: 'kmeans',
  n_clusters: 4,
  n_init: 10,
  hierarchical_n_clusters: 4,
  linkage: 'ward',
  metric: 'euclidean',
  eps: 1.2,
  min_samples: 3,
  gmm_n_components: 4,
  covariance_type: 'full',
  reg_covar: 0.000001,
  random_state: 42,
}

console.log('running a real Milano K-Means clustering via the API ...')
const created = await (
  await fetch(`${BASE}/api/clusters/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: config }),
  })
).json()
console.log('cluster run:', created.cluster_run_id)

let state = null
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 2000))
  state = await (await fetch(`${BASE}/api/clusters/${created.cluster_run_id}`)).json()
  if (!['Queued', 'Running'].includes(state.status)) break
}
console.log('clustering status:', state.status, 'clusters:', state.metrics?.n_clusters, 'silhouette:', state.metrics?.silhouette)

const evaluations = await (await fetch(`${BASE}/api/evaluations`)).json()
const evaluation = evaluations.evaluations.find((e) => e.status === 'Completed')
console.log('using evaluation:', evaluation?.evaluation_id)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })

await page.goto(`${BASE}/clustering`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.locator('button:has-text("Open")').first().click()
await page.waitForTimeout(3500)
await page.screenshot({ path: path.join(SHOTS, '08-module2-clustering-results.png'), fullPage: true })
console.log('saved 08-module2-clustering-results.png')

await page.goto(`${BASE}/evaluation`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
await page.locator('.ant-collapse-header:has-text("Evaluation History")').first().click()
await page.waitForTimeout(800)
await page.locator('.tn-history-row button:has-text("View")').first().click()
await page.waitForTimeout(6000)
await page.screenshot({ path: path.join(SHOTS, '09-module5-evaluation-results.png'), fullPage: true })
console.log('saved 09-module5-evaluation-results.png')

await browser.close()
