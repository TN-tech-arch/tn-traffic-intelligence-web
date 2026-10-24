/** Module 4 two-column redesign, history actions and real monitoring regression. */

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.TN_UI_BASE ?? 'http://127.0.0.1:8077'
const SHOTS = path.resolve('..', 'data', 'screenshots')
const results = []
fs.mkdirSync(SHOTS, { recursive: true })

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1800, height: 1300 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))

await page.goto(`${BASE}/training`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForSelector('.tn-m4-layout', { timeout: 60000 })
await page.waitForTimeout(6000)

const layout = page.locator('.tn-m4-layout')
const columns = await layout.evaluate((node) => getComputedStyle(node).gridTemplateColumns)
const widths = columns.split(' ').map((value) => Number.parseFloat(value))
check(
  '1 页面为严格两栏布局',
  widths.length === 2 &&
    Math.abs(widths[0] / (widths[0] + widths[1]) - 0.32) <= 0.01 &&
    Math.abs(widths[1] / (widths[0] + widths[1]) - 0.68) <= 0.01,
  columns,
)
check('2 右侧独立面板已删除', (await page.locator('.tn-pane-info').count()) === 0)
check(
  '3 左侧包含配置区和实验历史',
  (await page.locator('.tn-m4-column').nth(0).locator('.tn-m4-card').count()) === 2,
)
const pageText = await page.locator('body').innerText()
check(
  '3.1 标题采用模块三格式',
  pageText.includes('配置区（Configuration）') &&
    !pageText.includes('1 · 配置区（Configuration）') &&
    pageText.includes('2 · 训练监控（Training Monitor）') &&
    pageText.includes('1 · 当前实验详情（Current Experiment Details）') &&
    pageText.includes('实验历史（Experiment History）') &&
    !pageText.includes('4 · 实验历史（Experiment History）'),
)
const configText = await page
  .locator('.tn-m4-column')
  .nth(0)
  .locator('.tn-m4-card')
  .nth(0)
  .innerText()
check(
  '3.2 配置参数与模块三一致且不编号',
  configText.includes('数据集选择（只读快照）') &&
    configText.includes('预测算法') &&
    !/[1-5]\s*·\s*(数据集选择|预测算法|模型参数|运行前检查|操作)/.test(configText) &&
    (await page.locator('[data-field="m4.dataset_id"]').count()) === 1 &&
    (await page.locator('[data-field="m4.algorithm_key"]').count()) === 1,
)

const firstHistory = page.locator('.tn-m4-history-item').first()
await firstHistory.waitFor({ state: 'visible', timeout: 30000 })
const actionTexts = await firstHistory.locator('button').allInnerTexts()
check(
  '4 每条实验历史仅保留打开和删除记录',
  actionTexts.length === 2 &&
    actionTexts[0].replace(/\s/g, '') === '打开' &&
    actionTexts[1].replace(/\s/g, '') === '删除记录',
  actionTexts.join(' | '),
)
check(
  '5 历史分页存在',
  (await page.locator('.tn-m4-history-filters').count()) === 1 &&
    ((await page.locator('.tn-m4-card .ant-pagination').count()) >= 1 ||
      (await page.locator('.tn-m4-history-item').count()) <= 6),
)

const bodyText = await page.locator('body').innerText()
check(
  '6 已移除保存模型、复制草稿、归档和评估入口',
  !bodyText.includes('保存模型') &&
    !bodyText.includes('复制为草稿') &&
    !bodyText.includes('归档') &&
    !bodyText.includes('开始评估'),
)
check(
  '7 训练监控不展示预测评估指标',
  !/\b(MAE|RMSE|MAPE|sMAPE|R2|R²)\b/.test(bodyText),
)

await firstHistory.locator('button').filter({ hasText: '删除记录' }).click()
const popconfirm = page.locator('.ant-popconfirm').last()
await popconfirm.waitFor({ state: 'visible', timeout: 10000 })
check(
  '8 删除前显示确认弹窗',
  (await popconfirm.innerText()).includes('删除这条实验记录'),
)
await popconfirm.locator('button').filter({ hasText: /取\s*消/ }).first().click()

const statusSelect = page.locator('.tn-m4-history-filters .ant-select').nth(2)
await statusSelect.click()
await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '已完成' }).first().click()
await page.waitForTimeout(500)
const completedItem = page.locator('.tn-m4-history-item').first()
await completedItem.waitFor({ state: 'visible', timeout: 30000 })
await completedItem.locator('button').filter({ hasText: /打\s*开/ }).click()
await page.getByTestId('m4-current-details').waitFor({ state: 'visible', timeout: 30000 })

const detailText = await page.getByTestId('m4-current-details').innerText()
check(
  '9 打开历史实验后显示唯一当前实验信息栏',
  detailText.includes('实验 ID') &&
    detailText.includes('算法') &&
    detailText.includes('当前状态') &&
    detailText.includes('开始时间') &&
    detailText.includes('实验总耗时') &&
    detailText.includes('含收尾'),
)
check(
  '10 中央只有一个详情栏和训练监控，不重复快照/指标卡',
  (await page.locator('.tn-m4-column').nth(1).locator('.tn-m4-card').count()) === 2,
)

const monitorTable = page.locator('.tn-m4-monitor .ant-table')
check('11 显示真实区域级训练状态', (await monitorTable.count()) >= 1 && (await monitorTable.first().locator('tbody tr').count()) >= 1)
check(
  '11.1 区分实验总耗时与区域训练耗时',
  (await monitorTable.first().locator('thead').innerText()).includes('区域训练耗时'),
)

await page.getByTestId('m4-training-logs').waitFor({ state: 'visible', timeout: 30000 })
const logsText = await page.getByTestId('m4-training-logs').innerText()
check(
  '12 训练过程与训练日志同页上下显示',
  logsText.length > 0 &&
    logsText.includes('experiment') &&
    (await page.locator('.tn-m4-monitor-tabs').count()) === 0 &&
    (await page.locator('.tn-m4-monitor-section-title').allInnerTexts()).join('|').includes('Training Process') &&
    (await page.locator('.tn-m4-monitor-section-title').allInnerTexts()).join('|').includes('Training Logs') &&
    (await page.getByRole('button', { name: '下载日志' }).count()) === 1,
)

await page.screenshot({ path: path.join(SHOTS, 'module4-redesign-selected.png'), fullPage: true, animations: 'disabled' })

await page.setViewportSize({ width: 850, height: 1100 })
await page.waitForTimeout(500)
const responsiveColumns = await layout.evaluate((node) => getComputedStyle(node).gridTemplateColumns)
check(
  '13 窄屏响应式回退为单栏',
  responsiveColumns.split(' ').length === 1,
  responsiveColumns,
)
await page.screenshot({ path: path.join(SHOTS, 'module4-redesign-responsive.png'), fullPage: true, animations: 'disabled' })

check(
  '14 浏览器无未预期错误',
  errors.filter((line) => !/favicon|ResizeObserver/.test(line)).length === 0,
  errors.slice(0, 2).join(' | '),
)

const failed = results.filter((result) => !result.ok).length
fs.writeFileSync(
  path.join(SHOTS, 'module4-redesign-results.json'),
  JSON.stringify({ base: BASE, columns, responsiveColumns, results }, null, 2),
)
await browser.close()
console.log(`\n${results.length - failed}/${results.length} Module 4 redesign checks passed`)
process.exit(failed ? 1 : 0)
