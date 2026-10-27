import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.TN_UI_BASE ?? 'https://tn-traffic-intelligence.onrender.com'
const SHOTS = path.resolve('..', 'data', 'screenshots')
fs.mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.getByText('TianNuo Traffic Intelligence', { exact: true }).first().waitFor({ timeout: 120000 })

  const registry = await page.evaluate(async () => (await fetch('/api/models/registry')).json())
  if (registry.algorithm_count !== 10) {
    throw new Error(`expected 10 models, received ${registry.algorithm_count}`)
  }
  console.log(`MODELS=${registry.models.map((model) => model.key).join(',')}`)

  const values = {
    source_key: 'milano',
    scope: 'single',
    region_id: 'ADRIANO',
    frequency: 'native',
    aggregation: 'mean',
    input_length: 24,
    output_length: 6,
    step: 1,
    train_ratio: 0.7,
    val_ratio: 0.15,
    test_ratio: 0.15,
    missing_mode: 'automatic',
    scaling: 'standard',
    time_start: '2013-11-01 00:00:00',
    time_end: '2013-11-07 23:50:00',
  }
  const build = await page.evaluate(async (payload) => {
    const response = await fetch('/api/datasets/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: payload }),
    })
    return { status: response.status, body: await response.json() }
  }, values)
  if (build.status !== 200 || build.body.dataset_id !== 'DS-MILANO-ADRIANO-0001') {
    throw new Error(`dataset build failed: ${JSON.stringify(build)}`)
  }
  const datasetId = build.body.dataset_id
  console.log(`DATASET=${datasetId}`)

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const runModel = async (model) => {
    const params = Object.fromEntries(model.params.map((item) => [item.key, item.default]))
    for (const key of ['epochs', 'n_estimators']) {
      if (key in params) params[key] = Math.min(Number(params[key]), key === 'epochs' ? 5 : 20)
    }
    for (const key of ['hidden_units', 'hidden_size']) {
      if (key in params) params[key] = Math.min(Number(params[key]), 16)
    }
    if ('d_model' in params) params.d_model = 16
    if ('n_heads' in params) params.n_heads = 4
    if ('encoder_layers' in params) params.encoder_layers = 1
    if ('dim_feedforward' in params) params.dim_feedforward = 32
    if ('batch_size' in params) params.batch_size = Math.min(Number(params.batch_size), 32)
    if ('learning_rate' in params) params.learning_rate = Math.max(Number(params.learning_rate), 0.003)

    const started = Date.now()
    const created = await page.evaluate(
      async ({ datasetId, algorithmKey, params }) => {
        const response = await fetch('/api/experiments/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataset_id: datasetId,
            algorithm_key: algorithmKey,
            params,
          }),
        })
        return { status: response.status, body: await response.json() }
      },
      { datasetId, algorithmKey: model.key, params },
    )
    if (created.status !== 200) {
      throw new Error(`${model.key} create failed: ${JSON.stringify(created)}`)
    }
    const experimentId = created.body.experiment_id
    let detail = null
    while (Date.now() - started < 240000) {
      detail = await page.evaluate(async (id) => (await fetch(`/api/experiments/${id}`)).json(), experimentId)
      if (['Completed', 'Partial', 'Failed', 'Stopped'].includes(detail.status)) break
      await sleep(1500)
    }
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`${model.key.toUpperCase()}=${detail?.status ?? 'TIMEOUT'} ${experimentId} ${elapsed}s`)
    if (!detail || !['Completed', 'Partial'].includes(detail.status)) {
      throw new Error(`${model.key} did not complete: ${JSON.stringify(detail)}`)
    }
    return { experimentId, model: model.key, status: detail.status }
  }

  const completed = []
  for (const model of registry.models) {
    completed.push(await runModel(model))
  }

  const evaluationCreated = await page.evaluate(
    async ({ datasetId, experimentIds }) => {
      const response = await fetch('/api/evaluations/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: datasetId,
          scope: 'single',
          region_id: 'ADRIANO',
          experiment_ids: experimentIds,
          test_selection: 'full',
        }),
      })
      return { status: response.status, body: await response.json() }
    },
    { datasetId, experimentIds: completed.map((item) => item.experimentId) },
  )
  if (evaluationCreated.status !== 200) {
    throw new Error(`evaluation create failed: ${JSON.stringify(evaluationCreated)}`)
  }
  const evaluationId = evaluationCreated.body.evaluation_id
  let evaluation = null
  const evaluationStarted = Date.now()
  while (Date.now() - evaluationStarted < 240000) {
    evaluation = await page.evaluate(async (id) => (await fetch(`/api/evaluations/${id}`)).json(), evaluationId)
    if (['Completed', 'Partial', 'Failed', 'Stopped'].includes(evaluation.status)) break
    await sleep(1500)
  }
  console.log(`EVALUATION=${evaluation?.status ?? 'TIMEOUT'} ${evaluationId}`)
  if (!evaluation || evaluation.status !== 'Completed') {
    throw new Error(`evaluation failed: ${JSON.stringify(evaluation)}`)
  }

  await page.goto(`${BASE}/training`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForTimeout(3000)
  await page.screenshot({ path: path.join(SHOTS, 'render-public-acceptance.png'), fullPage: true })

  const firstCookie = (await context.cookies()).find((item) => item.name === 'tn_web_session')
  const freshContext = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const freshPage = await freshContext.newPage()
  await freshPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  const freshCookie = (await freshContext.cookies()).find((item) => item.name === 'tn_web_session')
  const freshCount = await freshPage.evaluate(async () => {
    const response = await fetch('/api/datasets?include_archived=true')
    return (await response.json()).datasets.length
  })
  console.log(`NEW_SESSION=${freshCookie?.value !== firstCookie?.value} HISTORY=${freshCount}`)
  await freshContext.close()

  fs.writeFileSync(
    path.join(SHOTS, 'render-public-acceptance.json'),
    JSON.stringify({ registry, datasetId, completed, evaluationId, errors }, null, 2),
  )
  console.log('PUBLIC_ACCEPTANCE=PASS')
} finally {
  await context.close()
  await browser.close()
}
