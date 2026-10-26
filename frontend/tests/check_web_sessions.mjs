import { chromium } from 'playwright'

const BASE = process.env.TN_UI_BASE ?? 'http://127.0.0.1:7860'
const browser = await chromium.launch({ headless: true })

const buildDataset = async (page) =>
  page.evaluate(async () => {
    const response = await fetch('/api/datasets/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: {
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
        },
      }),
    })
    return { status: response.status, body: await response.json() }
  })

const datasetCount = async (page) =>
  page.evaluate(async () => {
    const response = await fetch('/api/datasets?include_archived=true')
    return (await response.json()).datasets.length
  })

try {
  const firstContext = await browser.newContext()
  const firstPage = await firstContext.newPage()
  await firstPage.goto(BASE, { waitUntil: 'domcontentloaded' })
  const firstCookie = (await firstContext.cookies()).find((item) => item.name === 'tn_web_session')
  if (!firstCookie) throw new Error('first browser did not receive an anonymous session cookie')
  if ((await datasetCount(firstPage)) !== 0) throw new Error('first browser did not start empty')
  const firstBuild = await buildDataset(firstPage)
  if (firstBuild.status !== 200 || firstBuild.body.dataset_id !== 'DS-MILANO-ADRIANO-0001') {
    throw new Error(`first browser build failed: ${JSON.stringify(firstBuild)}`)
  }
  await firstPage.reload({ waitUntil: 'domcontentloaded' })
  if ((await datasetCount(firstPage)) !== 1) throw new Error('refresh did not retain the same session history')

  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()
  await secondPage.goto(BASE, { waitUntil: 'domcontentloaded' })
  const secondCookie = (await secondContext.cookies()).find((item) => item.name === 'tn_web_session')
  if (!secondCookie || secondCookie.value === firstCookie.value) {
    throw new Error('second browser did not receive an independent anonymous session')
  }
  if ((await datasetCount(secondPage)) !== 0) throw new Error('second browser did not start empty')
  const secondBuild = await buildDataset(secondPage)
  if (secondBuild.status !== 200 || secondBuild.body.dataset_id !== 'DS-MILANO-ADRIANO-0001') {
    throw new Error(`second browser numbering was not reset: ${JSON.stringify(secondBuild)}`)
  }

  await firstContext.close()
  await secondContext.close()
  console.log('PASS browser sessions persist on refresh, isolate histories, and reset numbering')
} finally {
  await browser.close()
}
