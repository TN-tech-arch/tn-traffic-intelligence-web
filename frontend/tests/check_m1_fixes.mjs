/**
 * Verification for the final Module 1 fixes:
 *  1. the map slice always sits inside the Analysis Time Range
 *  2. Max Lag distinguishes Auto from manual and shows the effective value
 *  3. weekly periodicity on a 14-day window is only a candidate
 */

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
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

await page.goto(`${BASE}/exploration`, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)

// 1. move the analysis start to 2013-11-02 via the end date first, then start
const endInput = page.locator('[data-field="m1.time_end"] input').first()
await endInput.click()
await endInput.fill('2013-11-15 23:50')
await page.keyboard.press('Enter')
await page.waitForTimeout(5000)
const startInput = page.locator('[data-field="m1.time_start"] input').first()
await startInput.click()
await startInput.fill('2013-11-02 00:00')
await page.keyboard.press('Enter')
await page.waitForTimeout(6000)

const rangeText = await page.locator('.tn-range-summary').first().innerText()
const slider = page.locator('input[type="range"]').first()
const sliderMin = Number(await slider.getAttribute('min'))
const sliderMax = Number(await slider.getAttribute('max'))
const sliderValue = Number(await slider.inputValue())
const sliceRow = await page.locator('.tn-inline:has-text("Time Slice")').first().innerText()
check(
  '1a 滑块范围与当前分析范围一致',
  sliderMin >= 141 && sliderMax > sliderMin,
  `min=${sliderMin} max=${sliderMax} value=${sliderValue}`,
)
check('1b 空截面位置被夹在范围内', sliderValue >= sliderMin && sliderValue <= sliderMax, `value=${sliderValue}`)
check(
  '1c 地图时间不早于分析起点',
  !sliceRow.includes('2013-11-01') && (sliceRow.includes('2013-11-02') || Number(sliceRow.match(/(\d{4}-\d{2}-\d{2})/)?.[1]?.slice(8)) >= 2),
  sliceRow.replace(/\n/g, ' '),
)

// move the slider to the last instant and verify it stays in range
await slider.fill(String(sliderMax))
await page.waitForTimeout(2500)
const lastRow = await page.locator('.tn-inline:has-text("Time Slice")').first().innerText()
check('1d 滑到末端仍显示分析范围内时间', lastRow.includes('2013-11-15'), lastRow.replace(/\n/g, ' '))

// 2. Auto / manual Max Lag
const acfCard = page.locator('.ant-card:has-text("自相关与趋势（ACF & Trend）")').first()
const autoLine = await acfCard.innerText()
check(
  '2a 自动模式显示实际生效最大滞后步数（不是 0）',
  /实际生效最大滞后步数：\d+ 步/.test(autoLine) && !/实际生效最大滞后步数：0 /.test(autoLine),
  (autoLine.match(/实际生效最大滞后步数：.*/) ?? [''])[0],
)
const autoSwitch = acfCard.locator('.ant-switch').first()
async function setAuto(on) {
  for (let i = 0; i < 4; i++) {
    const checked = (await autoSwitch.getAttribute('aria-checked')) === 'true'
    if (checked === on) return true
    await autoSwitch.click({ force: true })
    await page.waitForTimeout(1200)
  }
  return false
}
await setAuto(false)
await page.waitForTimeout(2500)
const manualInput = page.locator('[data-field="m1.acf_max_lag"] input').first()
const manualValue = Number(await manualInput.inputValue())
check('2b 切到手动模式时用当前生效值预填', manualValue > 0, `value=${manualValue}`)
await manualInput.click({ clickCount: 3 })
await manualInput.fill('200')
await page.keyboard.press('Tab')
await page.waitForTimeout(5000)
const manualText = await acfCard.innerText()
check('2c 手动值生效并显示实际值', /实际生效：200 步/.test(manualText), (manualText.match(/实际生效：.*/) ?? [''])[0])
await manualInput.click({ clickCount: 3 })
await manualInput.fill('5000')
await page.keyboard.press('Tab')
await page.waitForTimeout(5000)
const overLimitError = await page.locator('[data-field="m1.acf_max_lag"] .tn-error-text').count()
check('2d 超过上限在字段下方报错', overLimitError > 0, `${overLimitError} error nodes`)
const autoRestored = await setAuto(true)
check('2e 可切回 Auto 自动模式', autoRestored, `aria-checked=${await autoSwitch.getAttribute('aria-checked')}`)
await page.waitForTimeout(6000)

// 3. weekly candidate vs confirmed
let acfInsight = ''
for (let i = 0; i < 20; i++) {
  acfInsight = await page.locator('.tn-insight-card:has-text("ACF & Trend Insights")').first().innerText()
  if (acfInsight.includes('7 天（周周期）')) break
  await page.waitForTimeout(1500)
}
if (!acfInsight.includes('7 天（周周期）')) {
  console.log('DIAGNOSTIC acf insight:', acfInsight.replace(/\n/g, ' | ').slice(0, 600))
}
const hasDailyConfirmed = acfInsight.includes('已确认的周期证据') && acfInsight.includes('24 小时')
const weeklyLine = acfInsight.split('\n').find((line) => /7(\.0)? 天/.test(line)) ?? ''
check('3a 14 天窗口下日周期可确认', hasDailyConfirmed)
check(
  '3b 周周期只作为候选并说明证据不足',
  /候选/.test(weeklyLine) && /未确认|证据不足|重复/.test(weeklyLine),
  weeklyLine.slice(0, 200),
)

await page.screenshot({ path: path.join(SHOTS, '14-m1-final-fixes.png'), fullPage: true })
const unexpectedErrors = consoleErrors.filter((line) => !line.includes('422'))
check('4 浏览器控制台无未预期错误', unexpectedErrors.length === 0, unexpectedErrors.slice(0, 2).join(' | '))

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
await browser.close()
process.exit(failed ? 1 : 0)
