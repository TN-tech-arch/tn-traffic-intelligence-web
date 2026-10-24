/** Module 1 Time Slice: slider/date/button sync and spatial linkage. */

import { chromium } from 'playwright'
import path from 'node:path'

const BASE = 'http://127.0.0.1:8077'
const SHOTS = path.resolve('..', 'data', 'screenshots')
const results = []

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } })
const consoleErrors = []
let spatialRequests = 0
page.on('pageerror', (error) => consoleErrors.push(String(error)))
page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()))
page.on('request', (request) => {
  if (new URL(request.url()).pathname === '/api/analysis/spatial') spatialRequests += 1
})

await page.goto(`${BASE}/exploration`, { waitUntil: 'networkidle' })
const sliceField = page.locator('[data-field="m1.time_slice"]')
const dateInput = sliceField.locator('.ant-picker input').first()
const slider = sliceField.locator('input[type="range"]')
await dateInput.waitFor({ state: 'visible', timeout: 60000 })
await page.waitForFunction(
  () => {
    const input = document.querySelector('[data-field="m1.time_slice"] .ant-picker input')
    return input instanceof HTMLInputElement && input.value.startsWith('2013-11-01')
  },
  undefined,
  { timeout: 60000 },
)

const centerPane = page.locator('.tn-three-pane > section').nth(1)
const infoPane = page.locator('.tn-three-pane > section').nth(2)
await infoPane.locator('.ant-tabs-tab').filter({ hasText: 'Spatial Analysis' }).click()
await page.waitForTimeout(1200)
const spatialPanel = infoPane.locator('.ant-tabs-tabpane-active')
await spatialPanel
  .locator('section[aria-label="Top 12 Regions"] .tn-insight-card')
  .waitFor({ state: 'visible', timeout: 60000 })

const help = sliceField.locator('.tn-help-trigger')
await help.hover()
await page.waitForTimeout(450)
const tooltip = page.locator('.tn-help-tooltip:visible .ant-tooltip-inner').first()
const tooltipText = (await tooltip.count()) ? await tooltip.innerText() : ''
const tooltipBg = (await tooltip.count())
  ? await tooltip.evaluate((node) => getComputedStyle(node).backgroundColor)
  : ''
check(
  '1 时间截面注释使用指定黑底悬停 Tooltip',
  tooltipText.includes('用于选择当前分析时刻') &&
    tooltipText.includes('Top 12 高流量区域') &&
    tooltipText.includes('Bottom 6 低流量区域') &&
    tooltipText.includes('区域流量分布图') &&
    tooltipBg === 'rgb(31, 36, 48)',
  `${tooltipBg} | ${tooltipText.slice(0, 70)}`,
)
await page.mouse.move(1500, 1200)

const initialDate = await dateInput.inputValue()
const initialSlider = Number(await slider.inputValue())
const initialFieldText = await sliceField.innerText()
check(
  '2 默认选中分析范围第一个时间点并显示序号',
  initialDate === '2013-11-01 00:00' &&
    initialSlider === Number(await slider.getAttribute('min')) &&
    initialFieldText.includes('时间点 1 / 8928') &&
    initialFieldText.includes('数据索引 0'),
  `${initialDate} | ${initialFieldText.replace(/\n/g, ' ')}`,
)
check(
  '3 初始“上一时刻”禁用，“下一时刻”可用',
  await sliceField.getByRole('button', { name: '上一时刻' }).isDisabled() &&
    (await sliceField.getByRole('button', { name: '下一时刻' }).isEnabled()),
  'boundary buttons',
)

const initialInsight = await spatialPanel
  .locator('section[aria-label="Top 12 Regions"] .tn-insight-card')
  .innerText()
spatialRequests = 0
await sliceField.getByRole('button', { name: '下一时刻' }).click()
await page.waitForFunction(
  () => {
    const input = document.querySelector('[data-field="m1.time_slice"] .ant-picker input')
    return input instanceof HTMLInputElement && input.value === '2013-11-01 00:10'
  },
  undefined,
  { timeout: 30000 },
)
await centerPane.getByText('空间截面：2013-11-01 00:10:00').waitFor({
  state: 'visible',
  timeout: 30000,
})
await page.waitForTimeout(600)
const nextRequestCount = spatialRequests
const nextInsight = await spatialPanel
  .locator('section[aria-label="Top 12 Regions"] .tn-insight-card')
  .innerText()
check(
  '4 下一时刻同步更新日期、地图与三张空间分析的数据源',
  (await dateInput.inputValue()) === '2013-11-01 00:10' &&
    (await centerPane.innerText()).includes('空间截面：2013-11-01 00:10:00') &&
    nextInsight !== initialInsight,
  `index=${await slider.inputValue()}`,
)

await sliceField.getByRole('button', { name: '上一时刻' }).click()
await page.waitForFunction(
  () => {
    const input = document.querySelector('[data-field="m1.time_slice"] .ant-picker input')
    return input instanceof HTMLInputElement && input.value === '2013-11-01 00:00'
  },
  undefined,
  { timeout: 30000 },
)
check('5 上一时刻返回前一个真实采样时间', (await dateInput.inputValue()) === '2013-11-01 00:00', await dateInput.inputValue())

await slider.focus()
await slider.press('End')
await page.waitForFunction(
  () => {
    const input = document.querySelector('[data-field="m1.time_slice"] .ant-picker input')
    return input instanceof HTMLInputElement && input.value === '2014-01-01 23:50'
  },
  undefined,
  { timeout: 30000 },
)
await centerPane.getByText('空间截面：2014-01-01 23:50:00').waitFor({
  state: 'visible',
  timeout: 30000,
})
check(
  '6 拖动滑块到末端同步日期、地图与时间点序号',
  (await dateInput.inputValue()) === '2014-01-01 23:50' &&
    (await centerPane.innerText()).includes('空间截面：2014-01-01 23:50:00') &&
    (await sliceField.innerText()).includes('时间点 8928 / 8928'),
  await dateInput.inputValue(),
)

await slider.focus()
await slider.press('Home')
await centerPane.getByText('空间截面：2013-11-01 00:00:00').waitFor({
  state: 'visible',
  timeout: 30000,
})
await page.waitForTimeout(500)
spatialRequests = 0
await dateInput.click()
await dateInput.fill('2013-11-05 12:07')
await dateInput.press('Enter')
await page.waitForFunction(
  () => {
    const input = document.querySelector('[data-field="m1.time_slice"] .ant-picker input')
    return input instanceof HTMLInputElement && input.value === '2013-11-05 12:10'
  },
  undefined,
  { timeout: 30000 },
)
await centerPane.getByText('空间截面：2013-11-05 12:10:00').waitFor({
  state: 'visible',
  timeout: 30000,
})
const dateRequestCount = spatialRequests
const dateInsight = await spatialPanel
  .locator('section[aria-label="Top 12 Regions"] .tn-insight-card')
  .innerText()
check(
  '7 直接选择日期时间会自动吸附到最近原生采样点并联动空间分析',
  (await dateInput.inputValue()) === '2013-11-05 12:10' &&
    (await centerPane.innerText()).includes('空间截面：2013-11-05 12:10:00') &&
    dateInsight !== initialInsight,
  `slider=${await slider.inputValue()}`,
)

await dateInput.click()
await dateInput.fill('2013-11-05 13:07')
await page.locator('.ant-picker-dropdown:visible .ant-picker-ok button').click()
await page.waitForFunction(
  () => {
    const input = document.querySelector('[data-field="m1.time_slice"] .ant-picker input')
    return input instanceof HTMLInputElement && input.value === '2013-11-05 13:10'
  },
  undefined,
  { timeout: 30000 },
)
await centerPane.getByText('空间截面：2013-11-05 13:10:00').waitFor({
  state: 'visible',
  timeout: 30000,
})
check(
  '7b 日期时间面板点击“确定”可正常提交',
  (await dateInput.inputValue()) === '2013-11-05 13:10' &&
    (await centerPane.innerText()).includes('空间截面：2013-11-05 13:10:00'),
  await dateInput.inputValue(),
)

await sliceField.getByRole('button', { name: '上一时刻' }).click()
await page.waitForTimeout(300)
const prevDate = await dateInput.inputValue()
await sliceField.getByRole('button', { name: '下一时刻' }).click()
await page.waitForTimeout(300)
check(
  '8 日期选择后前后时刻按原生采样间隔移动',
  prevDate === '2013-11-05 13:00' && (await dateInput.inputValue()) === '2013-11-05 13:10',
  `${prevDate} → ${await dateInput.inputValue()}`,
)
check(
  '8b 每次时间截面变化只发起一次空间分析请求',
  nextRequestCount === 1 && dateRequestCount === 1,
  `next=${nextRequestCount} date=${dateRequestCount}`,
)

const rangeStart = page.locator('[data-field="m1.time_start"] input').first()
const rangeEnd = page.locator('[data-field="m1.time_end"] input').first()
await rangeEnd.click()
await rangeEnd.fill('2013-11-04 23:50')
await rangeEnd.press('Enter')
await page.waitForTimeout(5000)
await rangeStart.click()
await rangeStart.fill('2013-11-03 00:00')
await rangeStart.press('Enter')
await page.waitForTimeout(6000)
const updatedSliderMin = Number(await slider.getAttribute('min'))
const updatedSliderMax = Number(await slider.getAttribute('max'))
check(
  '9 修改分析范围后滑块和日期边界同步更新',
  updatedSliderMin === 288 &&
    updatedSliderMax === 575 &&
    Number(await slider.inputValue()) >= updatedSliderMin &&
    Number(await slider.inputValue()) <= updatedSliderMax,
  `min=${updatedSliderMin} max=${updatedSliderMax} value=${await slider.inputValue()}`,
)

await dateInput.click()
await dateInput.fill('2013-11-06 12:00')
await dateInput.press('Enter')
await page.waitForFunction(
  () => {
    const input = document.querySelector('[data-field="m1.time_slice"] .ant-picker input')
    return input instanceof HTMLInputElement && input.value === '2013-11-04 23:50'
  },
  undefined,
  { timeout: 30000 },
).catch(() => undefined)
const clampedDate = await dateInput.inputValue()
check(
  '10 越界日期时间被拒绝或夹紧在分析范围内',
  clampedDate <= '2013-11-04 23:50' && clampedDate >= '2013-11-03 00:00',
  clampedDate,
)

await page.locator('[data-field="m1.source_key"] .ant-select-selector').click()
await page
  .locator('.ant-select-dropdown:visible .ant-select-item-option')
  .filter({ hasText: 'ZTE' })
  .first()
  .click()
await page.waitForFunction(
  () => {
    const input = document.querySelector('[data-field="m1.time_slice"] .ant-picker input')
    const range = document.querySelector('#m1-time-slice')
    return (
      input instanceof HTMLInputElement &&
      input.value.startsWith('2024-07-28') &&
      range instanceof HTMLInputElement &&
      Number(range.max) === 2783
    )
  },
  undefined,
  { timeout: 60000 },
)
const zteDate = await dateInput.inputValue()
const zteSliderMax = Number(await slider.getAttribute('max'))
const zteLeftText = await page.locator('.tn-three-pane > section').nth(0).innerText()
check(
  '11 切换 ZTE 后使用 15 分钟原生时间轴并回到首个时间点',
  zteDate === '2024-07-28 00:00' &&
    zteSliderMax === 2783 &&
    zteLeftText.includes('采样间隔：15 分钟'),
  `${zteDate} max=${zteSliderMax}`,
)
const zteSpatial = await page.evaluate(async () => {
  const response = await fetch('/api/analysis/spatial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_key: 'zte',
      frequency: 'native',
      aggregation: 'mean',
      time_index: 0,
      time_start: '2024-07-28 00:00:00',
      time_end: '2024-08-25 23:45:00',
    }),
  })
  return await response.json()
})
check(
  '12 ZTE 缺失区域保持 No Data，真实零值仍参与有效观测',
  zteSpatial.gis_no_data_count === 14 &&
    zteSpatial.value_region_count === 148,
  `value=${zteSpatial.value_region_count} gis_no_data=${zteSpatial.gis_no_data_count}`,
)
check(
  '13 浏览器控制台无未预期错误',
  consoleErrors.filter((line) => !line.includes('422')).length === 0,
  consoleErrors.slice(0, 2).join(' | '),
)

await page.screenshot({ path: path.join(SHOTS, 'm1-time-slice-current.png'), fullPage: true })
await browser.close()

const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} Time Slice checks passed`)
process.exit(failed ? 1 : 0)
