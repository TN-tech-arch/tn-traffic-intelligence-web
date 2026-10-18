/**
 * Real browser interaction test (Playwright + headless Chromium).
 *
 * Covers the UI/UX acceptance items that cannot be proven by API tests alone:
 * T31 (two row navigation, no avatar, three panes), T39 (all controls usable),
 * T44 (responsive two row nav + exactly three panes), T45-T51 (per field live
 * validation, separate warnings, aria feedback, All Models per algorithm status).
 *
 * Run with the API serving the production build:
 *   node frontend/tests/ui_check.mjs
 */

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.TN_UI_BASE ?? 'http://127.0.0.1:8077'
const SHOTS = path.resolve('..', 'data', 'screenshots')
fs.mkdirSync(SHOTS, { recursive: true })

const results = []
let failures = 0

function record(name, passed, detail) {
  results.push({ name, passed, detail })
  if (!passed) failures += 1
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function fieldErrorText(page, fieldPath) {
  const container = page.locator(`[data-field="${fieldPath}"]`)
  if (!(await container.count())) return null
  const errorNode = container.locator('.tn-error-text')
  if (!(await errorNode.count())) return null
  return (await errorNode.first().innerText()).trim()
}

async function fieldWarningText(page, fieldPath) {
  const container = page.locator(`[data-field="${fieldPath}"]`)
  if (!(await container.count())) return null
  const warningNode = container.locator('.tn-warning-text')
  if (!(await warningNode.count())) return null
  return (await warningNode.first().innerText()).trim()
}

async function setField(page, fieldPath, value) {
  const input = page.locator(`[data-field="${fieldPath}"] input`).first()
  await input.click({ clickCount: 3 })
  await input.fill(String(value))
  await page.waitForTimeout(450)
}

/** Expand a category group in the algorithm list only when it is collapsed. */
async function openAlgorithmGroup(page, label) {
  const header = page.locator('.ant-collapse-header', { hasText: label }).first()
  const expanded = await header.getAttribute('aria-expanded')
  if (expanded !== 'true') {
    await header.click()
    await page.waitForTimeout(500)
  }
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (error) => consoleErrors.push(String(error)))

try {
  // ---------------------------------------------------------------- Home
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const navItems = await page.locator('.tn-nav-item').allInnerTexts()
  record(
    'T31/T44 双行导航包含 6 个模块',
    navItems.length === 6,
    navItems.map((t) => t.split('\n')[0]).join(' | '),
  )
  const navLabels = navItems.map((t) => t.replace(/\n/g, ' ').trim())
  record(
    'T31 导航项统一为中文主名称 + 英文副名称',
    ['首页', '探索性分析', '功能区聚类', '数据集构建', '模型训练', '预测评估'].every((label) => navLabels.join('|').includes(label)) &&
      ['Home', 'Exploration', 'Clustering', 'Dataset', 'Training', 'Evaluation'].every((label) => navLabels.join('|').includes(label)),
    navLabels.join('|'),
  )
  const heroTitle = await page.locator('.tn-hero-title').innerText()
  record('T40 TN 品牌标题与 Logo', heroTitle.includes('TianNuo') && (await page.locator('img.tn-logo').count()) === 1, heroTitle)
  const imgSources = await page.locator('img').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('src') ?? ''))
  record(
    'T31/T40 页面不含卡通人物或头像资源',
    imgSources.every((src) => !/avatar|person|cartoon|mascot|face/i.test(src)),
    imgSources.join(','),
  )
  const statValues = await page.locator('.tn-stat-value').allInnerTexts()
  record(
    'T32 首页真实数字（3 数据源 / 459 有效区域 / 12 算法 / 5 模块）',
    statValues.slice(0, 4).join(',') === '3,459,12,5',
    statValues.slice(0, 6).join(','),
  )
  const recentText = await page.locator('.ant-timeline, .tn-empty').first().innerText().catch(() => '')
  record('T32 Recent Activity 显示真实数据库记录（空态或真实 ID）', recentText.length > 0, recentText.slice(0, 80))
  await page.screenshot({ path: path.join(SHOTS, '01-home.png'), fullPage: true })

  // ---------------------------------------------------- Module 1 (three panes)
  await page.click('.tn-nav-item >> text=Exploration')
  await page.waitForTimeout(2500)
  const paneCount = await page.locator('.tn-three-pane > section').count()
  record('T31/T44 模块工作区仅三栏（Configuration/Visualization/Information）', paneCount === 3, `${paneCount} panes`)
  const moduleTabs = await page.locator('.tn-pane-info .ant-tabs-tab').allInnerTexts()
  record(
    'T31 M1 三个右侧 Tab 齐全',
    ['Temporal Analysis', 'Spatial Analysis', 'Multi-City Comparison'].every((label) =>
      moduleTabs.some((text) => text.includes(label)),
    ) &&
      !moduleTabs.some((text) => text.trim() === 'Hourly Profile'),
    moduleTabs.join('|'),
  )
  const mapVisible = await page.locator('.leaflet-container').count()
  record('T04 GIS 地图常驻（切换 Tab 不消失）', mapVisible === 1, `leaflet containers: ${mapVisible}`)
  const vectorLayers = await page.evaluate(async () => {
    const response = await fetch('/api/data/geometry?source_key=milano')
    const geo = await response.json()
    return {
      features: geo.features.length,
      canvases: document.querySelectorAll('.leaflet-container canvas').length,
      paths: document.querySelectorAll('.leaflet-container svg path').length,
    }
  })
  record(
    'T04/T02 GIS 真实多边形已渲染（Milano 88 个区域，Canvas 渲染）',
    vectorLayers.features === 88 && vectorLayers.canvases >= 1,
    `features=${vectorLayers.features} canvases=${vectorLayers.canvases} svgPaths=${vectorLayers.paths}`,
  )
  for (const tabName of ['Spatial Analysis', 'Multi-City Comparison']) {
    await page.locator('.tn-pane-info .ant-tabs-tab', { hasText: tabName }).click()
    await page.waitForTimeout(400)
  }
  const mapStillThere = await page.locator('.leaflet-container').count()
  record('T04 切换右侧 Tab 后 GIS 仍然存在', mapStillThere === 1, `leaflet containers: ${mapStillThere}`)
  await page.screenshot({ path: path.join(SHOTS, '02-module1-exploration.png'), fullPage: true })

  // ------------------------------------------------------------ Module 2
  await page.click('.tn-nav-item >> text=Clustering')
  await page.waitForTimeout(1500)
  const m2Tabs = (await page.locator('.tn-pane-info .ant-tabs-tab').allInnerTexts()).map((t) => t.trim())
  record(
    'T31 M2 三个右侧分析 Tab 齐全，区域列表位于中央',
    ['Cluster Overview', 'Typical Patterns', 'Quality Evaluation'].every((t) =>
      m2Tabs.some((text) => text.includes(t)),
    ) &&
      !m2Tabs.some((text) => text.includes('Region List')) &&
      (await page.locator('.tn-three-pane > section').nth(1).locator('section[aria-label="Region List"]').count()) === 1,
    m2Tabs.join('|'),
  )
  // eps invalid then corrected
  await page.locator('.tn-pane input, .tn-pane .ant-select-selector').first().waitFor()
  await page.locator('[data-field="m2.algorithm"] .ant-select-selector').click()
  await page.locator('.ant-select-item-option', { hasText: 'DBSCAN' }).first().click()
  await page.waitForTimeout(400)
  await setField(page, 'm2.eps', 0)
  const epsError = await fieldErrorText(page, 'm2.eps')
  record('T45/T46 eps=0 在输入框下方显示错误', Boolean(epsError && epsError.includes('大于 0')), epsError ?? 'no error shown')
  await setField(page, 'm2.eps', 1.2)
  const epsErrorCleared = await fieldErrorText(page, 'm2.eps')
  record('T45 修正后错误立即清除', !epsErrorCleared, epsErrorCleared ?? 'cleared')
  const nClustersHidden = await page.locator('[data-field="m2.n_clusters"]').count()
  record('T49 切换算法后联动隐藏不相关参数（K-Means 专属项）', nClustersHidden === 0, `n_clusters visible: ${nClustersHidden}`)
  const helpButtons = await page.locator('.tn-field-label button[aria-label$="帮助信息"]').count()
  record('T51 每个参数字段都有 ⓘ 帮助入口', helpButtons > 5, `${helpButtons} help buttons`)
  await page.screenshot({ path: path.join(SHOTS, '03-module2-clustering.png'), fullPage: true })

  // ------------------------------------------------------------ Module 3
  await page.click('.tn-nav-item >> text=Dataset')
  await page.waitForTimeout(2000)
  const m3Tabs = (await page.locator('.tn-pane-info .ant-tabs-tab').allInnerTexts()).map((t) => t.trim())
  record(
    'T31/T39 M3 三个核心 Tab + Dataset Management',
    ['Dataset Overview', 'Window Preview', 'Data Quality', 'Dataset Management'].every((t) =>
      m3Tabs.some((text) => text.includes(t)),
    ),
    m3Tabs.join('|'),
  )
  await setField(page, 'm3.train_ratio', 0.7)
  await setField(page, 'm3.val_ratio', 0.2)
  await setField(page, 'm3.test_ratio', 0.2)
  await page.locator('[data-field="m3.test_ratio"] .tn-error-text').waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined)
  const ratioError = await fieldErrorText(page, 'm3.test_ratio')
  record('T09/T46 比例之和≠100% 时字段下方报错', Boolean(ratioError && ratioError.includes('100%')), ratioError ?? 'no error')
  await setField(page, 'm3.test_ratio', 0.1)
  await page.waitForTimeout(600)
  const ratioCleared = await fieldErrorText(page, 'm3.test_ratio')
  record('T09 比例修正后错误清除', !ratioCleared, ratioCleared ?? 'cleared')
  await setField(page, 'm3.input_length', 0)
  const inputLengthError = await fieldErrorText(page, 'm3.input_length')
  record('T08/T48 L=0 在输入框下方报错', Boolean(inputLengthError && inputLengthError.includes('不能小于')), inputLengthError ?? 'no error')
  await setField(page, 'm3.input_length', 24)
  await page.click('button:has-text("实时预览")')
  await page.waitForTimeout(3500)
  const previewText = await page.locator('.tn-three-pane section').nth(1).innerText()
  record(
    'T08 中央三个堆叠预览区显示真实窗口/切分/覆盖信息',
    previewText.includes('Sliding Window Preview') &&
      previewText.includes('Chronological Split Preview') &&
      previewText.includes('Forecast Time Preview') &&
      previewText.includes('窗口'),
    previewText.slice(0, 60).replace(/\n/g, ' '),
  )
  await page.screenshot({ path: path.join(SHOTS, '04-module3-dataset.png'), fullPage: true })

  // ------------------------------------------------------------ Module 4
  await page.click('.tn-nav-item >> text=Training')
  await page.waitForTimeout(2500)
  const m4Tabs = (await page.locator('.tn-pane-info .ant-tabs-tab').allInnerTexts()).map((t) => t.trim())
  record(
    'T31/T39 M4 三个右侧 Tab 齐全（含实验历史管理）',
    ['Training Overview', 'Training Logs', 'Experiment History'].every((t) =>
      m4Tabs.some((text) => text.includes(t)),
    ),
    m4Tabs.join('|'),
  )
  const allModelsEntry = await page.locator('text=全部模型（All Models，12 种）').count()
  record('T12/T20 All Models 位于算法列表顶部且标注为批量编排', allModelsEntry > 0, `${allModelsEntry} matches`)
  // transformer validation
  await openAlgorithmGroup(page, '深度学习')
  await page.locator('.tn-pane div[role="button"]', { hasText: 'Transformer' }).first().click()
  await page.waitForTimeout(800)
  await setField(page, 'model_configs.transformer.params.d_model', 130)
  const headsError = await fieldErrorText(page, 'model_configs.transformer.params.n_heads')
  record('T15/T45 d_model=130 与 n_heads=8 整除错误显示在 n_heads 下方', Boolean(headsError && headsError.includes('不能整除')), headsError ?? 'no error')
  await setField(page, 'model_configs.transformer.params.d_model', 128)
  const headsCleared = await fieldErrorText(page, 'model_configs.transformer.params.n_heads')
  record('T15 修正 d_model=128 后立即允许继续', !headsCleared, headsCleared ?? 'cleared')
  // dropout error + epochs warning must be separated
  await openAlgorithmGroup(page, '深度学习')
  await page.locator('.tn-pane div[role="button"]', { hasText: 'LSTM' }).first().click()
  await page.waitForTimeout(600)
  await setField(page, 'model_configs.lstm.params.dropout', 1.5)
  const dropoutError = await fieldErrorText(page, 'model_configs.lstm.params.dropout')
  record('T48 dropout=1.5 前端字段下方报错', Boolean(dropoutError && dropoutError.includes('小于 1')), dropoutError ?? 'no error')
  const advancedSwitch = page.locator('.tn-field-label .ant-switch').first()
  await advancedSwitch.click()
  await page.waitForTimeout(500)
  await setField(page, 'model_configs.lstm.params.epochs', 10000)
  const epochsWarning = await fieldWarningText(page, 'model_configs.lstm.params.epochs')
  const epochsError = await fieldErrorText(page, 'model_configs.lstm.params.epochs')
  record(
    'T46/T49 Epochs=10000 显示为 Warning（与 Error 分离，且不是取值非法）',
    Boolean(epochsWarning) && !epochsError,
    `warning=${epochsWarning ?? 'none'} error=${epochsError ?? 'none'}`,
  )
  const runButtonDisabled = await page.locator('button:has-text("开始训练")').first().isDisabled()
  record('T46 仅存在 Warning 时不会误禁用提交（Dropout 错误仍在，需先修正）', runButtonDisabled === true, `run disabled: ${runButtonDisabled}`)
  await setField(page, 'model_configs.lstm.params.dropout', 0.2)
  await page.waitForFunction(
    () => {
      const button = Array.from(document.querySelectorAll('button')).find((node) =>
        node.textContent?.includes('开始训练'),
      )
      return button instanceof HTMLButtonElement && !button.disabled
    },
    undefined,
    { timeout: 12000 },
  ).catch(() => undefined)
  const runEnabled = await page.locator('button:has-text("开始训练")').first().isEnabled()
  record('T45/T46 错误修正后 Run 恢复可用（Warning 不阻止）', runEnabled === true, `run enabled: ${runEnabled}`)
  // All Models per algorithm view
  await page.locator('div[role="button"]', { hasText: '全部模型（All Models，12 种）' }).first().click()
  await page.waitForTimeout(1200)
  const modelGroups = await page.locator('.tn-pane .ant-collapse-item').count()
  record('T50 All Models 显示 12 个独立参数组', modelGroups >= 12, `${modelGroups} groups`)
  const runnableTags = await page.locator('.tn-pane .ant-tag:has-text("可运行")').count()
  record('T50 每个算法可定位到 Error/Warning 与可运行状态', runnableTags >= 12, `${runnableTags} runnable tags`)
  await page.screenshot({ path: path.join(SHOTS, '05-module4-training.png'), fullPage: true })

  // ------------------------------------------------------------ Module 5
  await page.click('.tn-nav-item >> text=Evaluation')
  await page.waitForTimeout(2500)
  const m5Tabs = (await page.locator('.tn-pane-info .ant-tabs-tab').allInnerTexts()).map((t) => t.trim())
  record(
    'T31/T39 M5 三个右侧 Tab + 历史管理折叠区',
    ['Metrics Overview', 'Model Ranking', 'Regional Performance'].every((t) =>
      m5Tabs.some((text) => text.includes(t)),
    ) &&
      (await page.locator('text=评价历史（Evaluation History）').count()) > 0,
    m5Tabs.join('|'),
  )
  const centerTabs = (await page.locator('.tn-three-pane section').nth(1).locator('.ant-tabs-tab').allInnerTexts()).map((t) => t.trim())
  record(
    'T29 M5 中央四个视图齐全',
    ['Prediction Comparison', 'Error Analysis', 'Forecast Horizon Analysis', 'Spatial Evaluation'].every((t) =>
      centerTabs.some((text) => text.includes(t)),
    ),
    centerTabs.join('|'),
  )
  await page.screenshot({ path: path.join(SHOTS, '06-module5-evaluation.png'), fullPage: true })

  // ------------------------------------------------- responsive / narrow view
  await page.setViewportSize({ width: 900, height: 1000 })
  await page.waitForTimeout(600)
  const narrowColumns = await page.evaluate(() => {
    const grid = document.querySelector('.tn-three-pane')
    return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0
  })
  record('T44 窄屏下三栏折叠为单列', narrowColumns === 1, `columns: ${narrowColumns}`)
  await page.screenshot({ path: path.join(SHOTS, '07-narrow-responsive.png'), fullPage: true })
  await page.setViewportSize({ width: 1600, height: 1000 })

  record('浏览器控制台没有未捕获错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} catch (error) {
  record('UI 测试执行完成', false, `异常: ${error.message}`)
} finally {
  await browser.close()
}

const summary = {
  at: new Date().toISOString(),
  base: BASE,
  total: results.length,
  failed: failures,
  results,
  console_errors: consoleErrors,
}
fs.writeFileSync(path.join(SHOTS, 'ui_check_result.json'), JSON.stringify(summary, null, 2))
console.log(`\n${results.length - failures}/${results.length} UI checks passed (screenshots in ${SHOTS})`)
process.exit(failures === 0 ? 0 : 1)
