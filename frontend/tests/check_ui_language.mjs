/**
 * Platform-wide UI language and terminology regression:
 * navigation, module headings, parameter labels, tabs, buttons, statuses,
 * chart headings, responsive overflow and screenshots for all six pages.
 */

import { chromium } from 'playwright'
import path from 'node:path'

const BASE = 'http://127.0.0.1:8077'
const SHOTS = path.resolve('..', 'data', 'screenshots')
const results = []
const hasBilingual = (body, text) => {
  const match = text.match(/^(.*?)（(.*)）$/)
  return match ? body.includes(match[1]) && body.includes(match[2]) : body.includes(text)
}

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } })
const consoleErrors = []
page.on('pageerror', (error) => consoleErrors.push(String(error)))
page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)

const nav = await page.locator('.tn-nav-item').evaluateAll((nodes) =>
  nodes.map((node) => ({
    title: node.querySelector('.tn-nav-sub')?.previousElementSibling?.textContent?.trim() ?? '',
    sub: node.querySelector('.tn-nav-sub')?.textContent?.trim() ?? '',
  })),
)
check(
  '1 顶部六个一级导航全部以中文为主',
  nav.map((item) => item.title).join('|') === '首页|探索性分析|功能区聚类|数据集构建|模型训练|预测评估',
  nav.map((item) => `${item.title}/${item.sub}`).join(' | '),
)
check(
  '2 导航第二行采用 M1–M5 与简短英文',
  ['Home', 'M1 · Exploration', 'M2 · Clustering', 'M3 · Dataset', 'M4 · Training', 'M5 · Evaluation'].every(
    (text, index) => nav[index]?.sub.includes(text),
  ),
  nav.map((item) => item.sub).join(' | '),
)
check('3 首页不再用 Start Exploring 作为主按钮', !(await page.locator('body').innerText()).includes('Start Exploring'), 'Chinese primary action')
check(
  '4 首页统计与卡片标题中英文主次一致',
  (await page.locator('body').innerText()).includes('数据源（Data Sources）') &&
    (await page.locator('body').innerText()).includes('数据源概览（Dataset Overview）') &&
    !(await page.locator('body').innerText()).includes('Recent Activity') &&
    (await page.locator('body').innerText()).includes('五模块工作流（Five-Module Workflow）'),
  'home titles',
)
check(
  '4b 数据源名称与单位说明使用中文',
  !(await page.locator('body').innerText()).includes('Traffic volume (source unit unknown)') &&
    (await page.locator('body').innerText()).includes('交通流量（源单位未知）'),
  'source and unit labels localised',
)
await page.screenshot({ path: path.join(SHOTS, '35-language-home.png'), fullPage: true })

const moduleChecks = [
  {
    nav: '探索性分析',
    title: '模块一｜探索性流量分析',
    subtitle: 'Exploratory Traffic Analysis',
    shot: '36-language-m1.png',
    must: ['时间分析（Temporal Analysis）', '空间分析（Spatial Analysis）', '多城市对比（Multi-City Comparison）'],
  },
  {
    nav: '功能区聚类',
    title: '模块二｜功能区聚类',
    subtitle: 'Functional Zone Clustering',
    shot: '37-language-m2.png',
    must: ['聚类概览（Cluster Overview）', '典型模式（Typical Patterns）', '质量评估（Quality Evaluation）', '区域列表（Region List）'],
  },
  {
    nav: '数据集构建',
    title: '模块三｜预测数据集构建',
    subtitle: 'Forecasting Dataset Construction',
    shot: '38-language-m3.png',
    must: ['数据集概览（Dataset Overview）', '窗口预览（Window Preview）', '数据质量（Data Quality）', '数据集管理（Dataset Management）'],
  },
  {
    nav: '模型训练',
    title: '模块四｜预测模型训练',
    subtitle: 'Forecast Model Training',
    shot: '39-language-m4.png',
    must: ['训练监控（Training Monitor）', '训练概览（Training Overview）', '训练日志（Training Logs）', '实验历史（Experiment History）'],
  },
  {
    nav: '预测评估',
    title: '模块五｜预测结果评估',
    subtitle: 'Prediction & Evaluation',
    shot: '40-language-m5.png',
    must: ['预测对比（Prediction Comparison）', '误差分析（Error Analysis）', '指标概览（Metrics Overview）', '区域表现（Regional Performance）'],
  },
]

for (const [index, module] of moduleChecks.entries()) {
  await page.locator('.tn-nav-item').filter({ hasText: module.nav }).click()
  const waits = { 探索性分析: 6500, 功能区聚类: 3500, 数据集构建: 3500, 模型训练: 7000, 预测评估: 4000 }
  await page.waitForTimeout(waits[module.nav] ?? 3000)
  if (module.nav === '模型训练') {
    await page.locator('.tn-field-label .tn-help-trigger').first().waitFor({ state: 'visible', timeout: 30000 })
  }
  const moduleTitle = await page.locator('.tn-module-title').innerText()
  const moduleSubtitle = await page.locator('.tn-module-title-en').innerText()
  const body = await page.locator('body').innerText()
  check(
    `${5 + index}.${index + 1} ${module.title} 标题为中英文双行`,
    moduleTitle.trim() === module.title && moduleSubtitle.trim() === module.subtitle,
    `${moduleTitle} / ${moduleSubtitle}`,
  )
  check(
    `${5 + index}.${index + 2} ${module.nav} 核心功能标题齐全且中文在前`,
    module.must.every((text) => hasBilingual(body, text)),
    module.must.join(' | '),
  )
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(`${5 + index}.${index + 3} ${module.nav} 页面无横向溢出`, overflow <= 1, `overflow=${overflow}`)
  await page.screenshot({ path: path.join(SHOTS, module.shot), fullPage: true })
}

await page.locator('.tn-nav-item').filter({ hasText: '数据集构建' }).click()
await page.waitForTimeout(1000)
const datasetLabels = await page.locator('.tn-field-label').allInnerTexts()
check(
  '11 Module 3 参数标签默认使用中文',
  ['数据源', '预测范围', '区域', '时间分辨率', '聚合方式', '输入长度（L）', '输出长度（H）', '滑动步长（S）', '训练集比例', '验证集比例', '测试集比例'].every(
    (text) => datasetLabels.some((label) => label.replace(/\s+/g, '').includes(text)),
  ) &&
    !datasetLabels.some((label) => /Dataset \/ Location|Prediction Scope|Temporal Resolution|Train Ratio|Validation Ratio|Test Ratio/.test(label)),
  datasetLabels.join(' | '),
)

await page.locator('.tn-nav-item').filter({ hasText: '模型训练' }).click()
await page.waitForTimeout(1500)
const trainingText = await page.locator('body').innerText()
check(
  '12 Module 4 批量入口、训练按钮与状态提示已中文化',
  trainingText.includes('全部模型（All Models，12 种）') &&
    trainingText.includes('开始训练') &&
    !trainingText.includes('Run Training') &&
    !trainingText.includes('Run All Models'),
  'training actions',
)
const rawStatuses = ['Queued', 'Created', 'Running', 'Stopping', 'Stopped', 'Completed', 'Partial', 'Failed', 'Skipped']
const tags = await page.locator('.ant-tag').allInnerTexts()
check(
  '13 状态标签不直接显示英文状态代码',
  !tags.some((tag) => rawStatuses.includes(tag.trim())),
  tags.slice(0, 10).join(' | '),
)

const parameterHelp = page.locator('.tn-field-label .tn-help-trigger').first()
await parameterHelp.waitFor({ state: 'visible', timeout: 20000 })
await parameterHelp.focus()
const visibleHelp = page.locator('.tn-help-tooltip:visible .ant-tooltip-inner').first()
await visibleHelp.waitFor({ state: 'visible', timeout: 10000 })
const helpText = await visibleHelp.innerText()
check(
  '14 参数帮助同时给出中文名、英文名与含义/范围',
  /实际含义与影响/.test(helpText) && /[（(][A-Za-z]/.test(helpText) && /默认/.test(helpText),
  helpText.replace(/\n/g, ' ').slice(0, 120),
)
await page.mouse.move(1500, 1200)

await page.setViewportSize({ width: 900, height: 1000 })
await page.waitForTimeout(500)
const responsiveOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
check('15 窄屏无横向溢出', responsiveOverflow <= 1, `overflow=${responsiveOverflow}`)
check('16 浏览器控制台无未预期错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} UI language checks passed`)
await browser.close()
process.exit(failed ? 1 : 0)
