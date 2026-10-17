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
    series: series.map((item) => ({
      name: item.name,
      type: item.type ?? 'line',
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 1.4, color: item.color },
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
