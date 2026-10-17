import ReactECharts from 'echarts-for-react'
import { Empty, Spin } from 'antd'

export function LineChart({
  series,
  x,
  height = 260,
  yName,
  loading,
  empty,
}: {
  series: Array<{ name: string; data: Array<number | null>; color?: string; type?: 'line' | 'bar' }>
  x: string[]
  height?: number
  yName?: string
  loading?: boolean
  empty?: boolean
}) {
  if (loading) return <Spin />
  if (empty || series.length === 0) return <Empty description="暂无真实数据" />
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 16, top: 18, bottom: 46 },
    xAxis: { type: 'category', data: x, axisLabel: { fontSize: 10, hideOverlap: true } },
    yAxis: { type: 'value', name: yName, nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
    dataZoom: [
      { type: 'inside', throttle: 60 },
      { type: 'slider', height: 16, bottom: 24 },
    ],
    series: series.map((item: any) => ({
      name: item.name,
      type: item.type ?? 'line',
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: item.width ?? 1.4, color: item.color, opacity: item.opacity ?? 1 },
      itemStyle: { color: item.color },
      data: item.data,
    })),
  }
  return <ReactECharts option={option} style={{ height }} notMerge lazyUpdate />
}

export function BarChart({
  categories,
  values,
  height = 240,
  color = '#2467E8',
  horizontal = false,
}: {
  categories: string[]
  values: Array<number | null>
  height?: number
  color?: string
  horizontal?: boolean
}) {
  const option = {
    tooltip: { trigger: 'axis' },
    grid: { left: horizontal ? 120 : 56, right: 16, top: 16, bottom: 30 },
    xAxis: horizontal
      ? { type: 'value', axisLabel: { fontSize: 10 } }
      : { type: 'category', data: categories, axisLabel: { fontSize: 10, rotate: 30 } },
    yAxis: horizontal
      ? { type: 'category', data: categories, axisLabel: { fontSize: 10 } }
      : { type: 'value', axisLabel: { fontSize: 10 } },
    series: [{ type: 'bar', data: values, itemStyle: { color }, barMaxWidth: 22 }],
  }
  return <ReactECharts option={option} style={{ height }} notMerge />
}

export function ScatterChart({
  points,
  height = 280,
  xName,
  yName,
}: {
  points: Array<{ x: number; y: number; group: number }>
  height?: number
  xName?: string
  yName?: string
}) {
  if (!points.length) return <Empty description="暂无真实数据" />
  const groups = Array.from(new Set(points.map((p) => p.group)))
  const option = {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 16, top: 18, bottom: 46 },
    xAxis: { type: 'value', name: xName, nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', name: yName, nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
    series: groups.map((group) => ({
      name: group < 0 ? '噪声 (-1)' : `簇 ${group}`,
      type: 'scatter',
      symbolSize: 9,
      data: points.filter((p) => p.group === group).map((p) => [p.x, p.y]),
    })),
  }
  return <ReactECharts option={option} style={{ height }} notMerge />
}

export interface RankItem {
  region_id: string
  display_name?: string
  value: number
  range_mean?: number | null
}

function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}k`
  return value.toFixed(2)
}

/** Horizontal ranking bars: item[0] is drawn at the top. */
export function HorizontalRankChart({
  items,
  color = '#2467E8',
  height = 340,
  timeAt,
  unit,
  showRangeMean = false,
  onSelect,
}: {
  items: RankItem[]
  color?: string
  height?: number
  timeAt?: string | null
  unit?: string
  showRangeMean?: boolean
  onSelect?: (regionId: string) => void
}) {
  if (!items.length) return <Empty description="当前时间截面没有有效区域" />
  const option = {
    animationDuration: 300,
    grid: { left: 6, right: 62, top: 6, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: any[]) => {
        const index = params?.[0]?.dataIndex ?? 0
        const entry = items[index]
        if (!entry) return ''
        const name = entry.display_name && entry.display_name !== entry.region_id
          ? `${entry.display_name}（${entry.region_id}）`
          : entry.region_id
        return (
          `<div style="font-size:12px;line-height:1.7">` +
          `<div><b>${name}</b></div>` +
          `<div>区域 ID：${entry.region_id}</div>` +
          (timeAt ? `<div>时间截面：${timeAt}</div>` : '') +
          `<div>当前值：<b>${entry.value.toFixed(2)}</b>${unit ? `（${unit}）` : ''}</div>` +
          (showRangeMean && entry.range_mean !== null && entry.range_mean !== undefined
            ? `<div style="color:#c3cadb">范围均值：${entry.range_mean.toFixed(2)}（所选日期范围）</div>`
            : '') +
          `<div style="color:#c3cadb">点击可在地图中定位</div>` +
          `</div>`
        )
      },
    },
    xAxis: {
      type: 'value',
      axisLabel: { fontSize: 10, formatter: (value: number) => compactNumber(value) },
      splitLine: { lineStyle: { color: '#eef3fa' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: items.map((item) => item.display_name || item.region_id),
      axisLabel: { fontSize: 10, width: 118, overflow: 'truncate' },
      axisTick: { show: false },
    },
    series: [
      {
        type: 'bar',
        data: items.map((item) => item.value),
        barMaxWidth: 15,
        showBackground: true,
        backgroundStyle: { color: '#f3f7fd' },
        itemStyle: { color, borderRadius: [0, 3, 3, 0] },
        label: {
          show: true,
          position: 'right',
          fontSize: 10,
          color: '#34506f',
          formatter: (params: any) => compactNumber(params.value),
        },
      },
    ],
  }
  return (
    <ReactECharts
      option={option}
      style={{ height }}
      notMerge
      onEvents={onSelect ? { click: (params: any) => onSelect(items[params.dataIndex]?.region_id) } : undefined}
    />
  )
}

/** Histogram of region values with count labels and range/count/percentage tooltips. */
export function HistogramChart({
  bins,
  height = 260,
  unit,
}: {
  bins: Array<{ index: number; start: number; end: number; count: number; pct: number }>
  height?: number
  unit?: string
}) {
  if (!bins.length) return <Empty description="当前时间截面没有有效区域" />
  const labels = bins.map((bin) => `${compactNumber(bin.start)}–${compactNumber(bin.end)}`)
  const option = {
    grid: { left: 6, right: 14, top: 18, bottom: 10, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: any[]) => {
        const bin = bins[params?.[0]?.dataIndex ?? 0]
        if (!bin) return ''
        return (
          `<div style="font-size:12px;line-height:1.7">` +
          `<div><b>${bin.start.toFixed(2)} – ${bin.end.toFixed(2)}</b>${unit ? `（${unit}）` : ''}</div>` +
          `<div>区域数量：<b>${bin.count}</b></div>` +
          `<div>占有效区域：<b>${bin.pct.toFixed(1)}%</b></div>` +
          `</div>`
        )
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { fontSize: 9, rotate: 32, hideOverlap: true, interval: 0 },
    },
    yAxis: {
      type: 'value',
      name: '区域数',
      nameTextStyle: { fontSize: 10 },
      minInterval: 1,
      axisLabel: { fontSize: 10 },
    },
    series: [
      {
        type: 'bar',
        data: bins.map((bin) => bin.count),
        barMaxWidth: 26,
        itemStyle: { color: '#12A67A', borderRadius: [3, 3, 0, 0] },
        label: { show: true, position: 'top', fontSize: 10, color: '#34506f' },
      },
    ],
  }
  return <ReactECharts option={option} style={{ height }} notMerge />
}

/** 24 hourly means with real sample counts in the tooltip; missing hours stay gaps. */
export function HourlyChart({
  regions,
  height = 240,
}: {
  regions: Array<{ region_id: string; hours: Array<{ hour: number; mean: number | null; samples: number }> }>
  height?: number
}) {
  if (!regions.length) return <Empty description="暂无真实数据" />
  const x = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
  const colors = ['#2467E8', '#12A67A', '#D98F00', '#8B5CF6', '#E4572E', '#0E9AA7']
  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        const rows = params.map((entry) => {
          const region = regions[entry.seriesIndex]
          const point = region?.hours?.[entry.dataIndex]
          const mean = point?.mean
          const samples = point?.samples ?? 0
          return `<div>${entry.marker}${entry.seriesName}: ${
            mean === null || mean === undefined ? '<b>No Data</b>' : `<b>${mean.toFixed(2)}</b>`
          } <span style="color:#8a99b5">（有效样本 ${samples}）</span></div>`
        })
        return `<div style="font-size:12px"><b>${x[params[0]?.dataIndex ?? 0]} 时段</b>${rows.join('')}</div>`
      },
    },
    legend: { type: 'scroll', bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 16, top: 18, bottom: 42 },
    xAxis: { type: 'category', data: x, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
    series: regions.map((region, index) => ({
      name: region.region_id,
      type: 'line',
      showSymbol: true,
      symbolSize: 4,
      connectNulls: false,
      data: region.hours.map((point) => point.mean),
      lineStyle: { width: 1.6, color: colors[index % colors.length] },
      itemStyle: { color: colors[index % colors.length] },
    })),
  }
  return <ReactECharts option={option} style={{ height }} notMerge />
}

/** Weekday vs weekend hourly curves (two groups, each with its own sample counts). */
export function WeekdayChart({
  weekday,
  weekend,
  weekdayLabel = '工作日',
  weekendLabel = '周末',
  height = 240,
}: {
  weekday: Array<{ hour: number; mean: number | null; samples: number }>
  weekend: Array<{ hour: number; mean: number | null; samples: number }>
  weekdayLabel?: string
  weekendLabel?: string
  height?: number
}) {
  const x = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) =>
        `<div style="font-size:12px"><b>${x[params[0]?.dataIndex ?? 0]} 时段</b>${params
          .map((entry) => {
            const point = entry.seriesIndex === 0 ? weekday[entry.dataIndex] : weekend[entry.dataIndex]
            const mean = point?.mean
            return `<div>${entry.marker}${entry.seriesName}: ${
              mean === null || mean === undefined ? '<b>No Data</b>' : `<b>${mean.toFixed(2)}</b>`
            } <span style="color:#8a99b5">（有效样本 ${point?.samples ?? 0}）</span></div>`
          })
          .join('')}</div>`,
    },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 16, top: 18, bottom: 42 },
    xAxis: { type: 'category', data: x, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
    series: [
      {
        name: weekdayLabel,
        type: 'line',
        showSymbol: true,
        symbolSize: 4,
        connectNulls: false,
        data: weekday.map((p) => p.mean),
        lineStyle: { width: 1.8, color: '#2467E8' },
        itemStyle: { color: '#2467E8' },
      },
      {
        name: weekendLabel,
        type: 'line',
        showSymbol: true,
        symbolSize: 4,
        connectNulls: false,
        data: weekend.map((p) => p.mean),
        lineStyle: { width: 1.8, color: '#D98F00' },
        itemStyle: { color: '#D98F00' },
      },
    ],
  }
  return <ReactECharts option={option} style={{ height }} notMerge />
}

/** ACF line with a zero reference line and the white-noise 95% band. */
export function AcfChart({
  lags,
  values,
  ci,
  intervalMinutes,
  height = 250,
}: {
  lags: number[]
  values: Array<number | null>
  ci: Array<number | null>
  intervalMinutes: number
  height?: number
}) {
  if (!lags.length) return <Empty description="有效样本不足，无法计算 ACF" />
  const upper = ci.map((c) => (c === null ? null : c))
  const lower = ci.map((c) => (c === null ? null : -c))
  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        const index = params[0]?.dataIndex ?? 0
        const value = values[index]
        const minutes = lags[index] * intervalMinutes
        const duration =
          minutes < 90 ? `${minutes} 分钟` : minutes < 2160 ? `${(minutes / 60).toFixed(1)} 小时` : `${(minutes / 1440).toFixed(1)} 天`
        return `<div style="font-size:12px"><b>Lag ${lags[index]}</b>（约 ${duration}）<br/>ACF = ${
          value === null || value === undefined ? 'N/A' : value.toFixed(4)
        }<br/><span style="color:#8a99b5">±95% 白噪声带：${ci[index]?.toFixed(3) ?? '—'}</span></div>`
      },
    },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 16, top: 18, bottom: 42 },
    xAxis: {
      type: 'category',
      data: lags.map(String),
      axisLabel: { fontSize: 10, hideOverlap: true },
      name: 'Lag（步）',
      nameTextStyle: { fontSize: 10 },
    },
    yAxis: { type: 'value', min: -1, max: 1, axisLabel: { fontSize: 10 } },
    series: [
      {
        name: 'ACF',
        type: 'line',
        showSymbol: false,
        data: values,
        lineStyle: { width: 1.6, color: '#2467E8' },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { formatter: '0', fontSize: 10 },
          lineStyle: { color: '#9fb0c9', type: 'dashed' },
          data: [{ yAxis: 0 }],
        },
      },
      {
        name: '+95%',
        type: 'line',
        showSymbol: false,
        data: upper,
        lineStyle: { width: 1, type: 'dashed', color: '#c9d3e2' },
        itemStyle: { color: '#c9d3e2' },
      },
      {
        name: '−95%',
        type: 'line',
        showSymbol: false,
        data: lower,
        lineStyle: { width: 1, type: 'dashed', color: '#c9d3e2' },
        itemStyle: { color: '#c9d3e2' },
      },
    ],
  }
  return <ReactECharts option={option} style={{ height }} notMerge />
}
