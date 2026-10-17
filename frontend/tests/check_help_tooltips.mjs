/**
 * Verifies the unified parameter help behaviour:
 * hover (200ms delay) -> dark tooltip, one at a time, closes on mouse leave,
 * keyboard focus also opens it, and the tooltip stays inside the viewport.
 */

import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:8077'
const results = []

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
await page.goto(`${BASE}/exploration`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)

const visibleTip = () => page.locator('.tn-help-tooltip:visible .ant-tooltip-inner')
const icons = page.locator('.tn-help-trigger')
const count = await icons.count()
check('1 参数帮助图标存在', count >= 6, `${count} icons`)
check('2 初始不显示任何帮助', (await visibleTip().count()) === 0, 'none visible')

await icons.nth(0).hover()
await page.waitForTimeout(450)
check('3 悬停后显示一个 Tooltip', (await visibleTip().count()) === 1, `count=${await visibleTip().count()}`)
const firstText = await visibleTip().first().innerText()
const styles = await visibleTip().first().evaluate((node) => ({
  bg: getComputedStyle(node).backgroundColor,
  color: getComputedStyle(node).color,
}))
check(
  '4 深色背景 + 白色文字',
  styles.bg === 'rgb(31, 36, 48)' && styles.color === 'rgb(255, 255, 255)',
  `${styles.bg} / ${styles.color}`,
)

await icons.nth(1).hover()
await page.waitForTimeout(450)
const secondText = await visibleTip().first().innerText()
check(
  '5 同一时间只显示一个，且内容随图标切换',
  (await page.locator('.tn-help-tooltip:visible').count()) === 1 && firstText !== secondText,
  secondText.slice(0, 60).replace(/\n/g, ' '),
)

const box = await page.locator('.tn-help-tooltip:visible').first().boundingBox()
const viewport = page.viewportSize()
check(
  '6 Tooltip 不超出视口',
  Boolean(box && viewport && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height),
  JSON.stringify(box),
)

await page.mouse.move(1500, 950)
await page.waitForTimeout(400)
check('7 鼠标移开后自动消失', (await page.locator('.tn-help-tooltip:visible').count()) === 0, 'closed')

// keyboard focus must also open the help
await icons.nth(2).focus()
await page.waitForTimeout(450)
check('8 键盘聚焦也能查看说明', (await page.locator('.tn-help-tooltip:visible').count()) === 1, 'focus opens')
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
check('9 焦点移走后关闭', (await page.locator('.tn-help-tooltip:visible').count()) === 0, 'closed on blur')

// clicking must not be required and must not leave a lingering tooltip
await icons.nth(3).click()
await page.mouse.move(1500, 950)
await page.waitForTimeout(400)
check('10 点击不会留下常驻说明', (await page.locator('.tn-help-tooltip:visible').count()) === 0, 'no lingering tip')

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} help-tooltip checks passed`)
await browser.close()
process.exit(failed ? 1 : 0)
