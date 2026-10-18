import ReactECharts from 'echarts-for-react'
import { Empty, Spin } from 'antd'

export function LineChart({
  series,
  x,
  height = 260,
  xName = '时间',
  xLabelInterval,
  yName,
  loading,
  empty,
}: {
  series: Array<{ name: string; data: Array<number | null>; color?: string; type?: 'line' | 'bar' }>
  x: string[]
  height?: number
  xName?: string
  xLabelInterval?: number
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
    xAxis: {
      type: 'category',
      data: x,
      name: xName,
      nameTextStyle: { fontSize: 10 },
      axisLabel: {
        fontSize: 10,
        hideOverlap: true,
        ...(xLabelInterval === undefined ? {} : { interval: xLabelInterval }),
      },
    },
    yAxis: { type: 'value', name: yName ?? '数值', nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
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
  xName,
  yName,
}: {
  categories: string[]
  values: Array<number | null>
  height?: number
  color?: string
  horizontal?: boolean
  xName?: string
  yName?: string
}) {
  const option = {
    tooltip: { trigger: 'axis' },
    grid: { left: horizontal ? 120 : 56, right: 16, top: 16, bottom: 30 },
    xAxis: horizontal
      ? { type: 'value', name: xName, axisLabel: { fontSize: 10 } }
      : { type: 'category', data: categories, name: xName, axisLabel: { fontSize: 10, rotate: 30 } },
    yAxis: horizontal
      ? { type: 'category', data: categories, name: yName, axisLabel: { fontSize: 10 } }
      : { type: 'value', name: yName, axisLabel: { fontSize: 10 } },
    series: [{ type: 'bar', data: values, itemStyle: { color }, barMaxWidth: 22 }],
  }
  return <ReactECharts option={option} style={{ height }} notMerge />
}

export function ScatterChart({
  points,
  height = 280,
  xName,
  yName,
  colorFor,
  onSelect,
}: {
  points: Array<{
    x: number
    y: number
    group: number
    name?: string
    regionId?: string
    extra?: string
  }>
  height?: number
  xName?: string
  yName?: string
  colorFor?: (group: number) => string
  onSelect?: (regionId: string) => void
}) {
  if (!points.length) return <Empty description="暂无真实数据" />
  const groups = Array.from(new Set(points.map((p) => p.group)))
  const clusterColors = Object.fromEntries(
    groups.map((group) => [String(group), colorFor?.(group) ?? '']),
  )
  const option = {
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        const data = params.data ?? {}
        return (
          `<div style="font-size:12px;line-height:1.7">` +
          `<div><b>${data.name ?? '—'}</b></div>` +
          `<div>所属簇：<b>${data.group < 0 ? '噪声（-1）' : `簇 ${data.group}`}</b></div>` +
          `<div>${xName ?? '横轴特征'}：${Number(data.value?.[0]).toFixed(3)}</div>` +
          `<div>${yName ?? '纵轴特征'}：${Number(data.value?.[1]).toFixed(3)}</div>` +
          (data.extra ? `<div style="color:#c3cadb">${data.extra}</div>` : '') +
          `<div style="color:#c3cadb">点击可在 GIS 地图中定位</div>` +
          `</div>`
        )
      },
    },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 16, top: 18, bottom: 46 },
    xAxis: { type: 'value', name: xName ?? '特征值', nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', name: yName ?? '特征值', nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
    series: groups.map((group) => ({
      name: group < 0 ? '噪声（-1）' : `簇 ${group}`,
      type: 'scatter',
      symbolSize: 9,
      itemStyle: { color: colorFor?.(group) },
      data: points
        .filter((p) => p.group === group)
        .map((p) => ({
          value: [p.x, p.y],
          name: p.name ?? p.regionId ?? '—',
          regionId: p.regionId,
          group: p.group,
          extra: p.extra,
        })),
    })),
  }
  return (
    <div
      data-testid="cluster-feature-scatter"
      data-cluster-axes={`${xName ?? '—'}|${yName ?? '—'}`}
      data-cluster-colors={JSON.stringify(clusterColors)}
    >
      <ReactECharts
        option={option}
        style={{ height }}
        notMerge
        onEvents={
          onSelect
            ? {
                click: (params: any) => {
                  const regionId = params.data?.regionId
                  if (regionId) onSelect(String(regionId))
                },
              }
            : undefined
        }
      />
    </div>
  )
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
      name: '流量值',
      nameTextStyle: { fontSize: 10 },
      axisLabel: { fontSize: 10, formatter: (value: number) => compactNumber(value) },
      splitLine: { lineStyle: { color: '#eef3fa' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: items.map((item) => item.display_name || item.region_id),
      name: '区域',
      nameTextStyle: { fontSize: 10 },
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
      name: '流量值区间',
      nameTextStyle: { fontSize: 10 },
      axisLabel: { fontSize: 9, rotate: 32, hideOverlap: true, interval: 0 },
    },
    yAxis: {
      type: 'value',
      name: '区域数量',
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

/** Multi-source Z-score curves on a fixed 0--23 clock; no DataZoom. */
export function MultiCityZChart({
  sources,
  height = 300,
}: {
  sources: Array<{
    source_key?: string
    display_name: string
    hourly_shape_z: Array<number | null>
  }>
  height?: number
}) {
  if (!sources.length) return <Empty description="暂无真实数据" />
  const x = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`)
  const colors = ['#2467E8', '#12A67A', '#D98F00', '#8B5CF6', '#E4572E']
  const option = {
    animationDuration: 300,
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        const index = params[0]?.dataIndex ?? 0
        const rows = sources.map((source, sourceIndex) => {
          const value = source.hourly_shape_z?.[index]
          const marker = params[sourceIndex]?.marker ?? ''
          return `<div>${marker}${source.display_name}: ${
            value === null || value === undefined ? '<b>无数据</b>' : `<b>${value.toFixed(3)}</b>`
          }</div>`
        })
        return (
          `<div style="font-size:12px;line-height:1.7">` +
          `<div><b>${x[index]}–${String((index + 1) % 24).padStart(2, '0')}:00</b></div>` +
          rows.join('') +
          `<div style="color:#c3cadb;margin-top:3px">Z=0 为该来源自身的典型小时平均水平</div>` +
          `</div>`
        )
      },
    },
    legend: { type: 'scroll', bottom: 0, textStyle: { fontSize: 10 } },
    grid: { left: 62, right: 18, top: 22, bottom: 60 },
    xAxis: {
      type: 'category',
      data: x,
      boundaryGap: false,
      name: '小时（0–23）',
      nameLocation: 'middle',
      nameGap: 27,
      nameTextStyle: { fontSize: 10, color: '#5b7095' },
      axisLabel: {
        fontSize: 9,
        interval: 0,
        formatter: (value: string) => value.slice(0, 2),
      },
      axisLine: { lineStyle: { color: '#b8c6dc' } },
    },
    yAxis: {
      type: 'value',
      name: 'Z-score（标准化相对水平）',
      nameLocation: 'middle',
      nameGap: 45,
      nameRotate: 90,
      nameTextStyle: { fontSize: 10, color: '#5b7095' },
      axisLabel: { fontSize: 9, formatter: (value: number) => value.toFixed(1) },
      splitLine: { lineStyle: { color: '#eef3fa' } },
    },
    series: sources.map((source, index) => ({
      name: source.display_name,
      type: 'line',
      showSymbol: true,
      symbolSize: 4,
      connectNulls: false,
      data: source.hourly_shape_z,
      lineStyle: { width: 1.9, color: colors[index % colors.length] },
      itemStyle: { color: colors[index % colors.length] },
      emphasis: { focus: 'series' },
      markLine:
        index === 0
          ? {
              silent: true,
              symbol: 'none',
              label: {
                formatter: 'Z=0（自身平均）',
                fontSize: 9,
                color: '#7a8bab',
                position: 'insideEndTop',
              },
              lineStyle: { color: '#9fb0c9', type: 'dashed', width: 1 },
              data: [{ yAxis: 0 }],
            }
          : undefined,
    })),
  }
  return (
    <div data-testid="m1-multicity-z-chart" data-datazoom="none">
      <ReactECharts option={option} style={{ height }} notMerge lazyUpdate />
    </div>
  )
}

/** 24 hourly means with real sample counts in the tooltip; missing hours stay gaps. */
export function HourlyChart({
  regions,
  height = 240,
  yName = '流量值',
}: {
  regions: Array<{ region_id: string; hours: Array<{ hour: number; mean: number | null; samples: number }> }>
  height?: number
  yName?: string
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
            mean === null || mean === undefined ? '<b>无数据</b>' : `<b>${mean.toFixed(2)}</b>`
          } <span style="color:#8a99b5">（有效样本 ${samples}）</span></div>`
        })
        return `<div style="font-size:12px"><b>${x[params[0]?.dataIndex ?? 0]} 时段</b>${rows.join('')}</div>`
      },
    },
    legend: { type: 'scroll', bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 16, top: 18, bottom: 42 },
    yAxis: { type: 'value', name: yName, nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
    xAxis: { type: 'category', data: x, name: '小时', nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
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
  yName = '流量值',
}: {
  weekday: Array<{ hour: number; mean: number | null; samples: number }>
  weekend: Array<{ hour: number; mean: number | null; samples: number }>
  weekdayLabel?: string
  weekendLabel?: string
  height?: number
  yName?: string
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
              mean === null || mean === undefined ? '<b>无数据</b>' : `<b>${mean.toFixed(2)}</b>`
            } <span style="color:#8a99b5">（有效样本 ${point?.samples ?? 0}）</span></div>`
          })
          .join('')}</div>`,
    },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 16, top: 18, bottom: 42 },
    xAxis: { type: 'category', data: x, name: '小时', nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', name: yName, nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
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
          value === null || value === undefined ? '无数据' : value.toFixed(4)
        }<br/><span style="color:#8a99b5">±95% 白噪声带：${ci[index]?.toFixed(3) ?? '—'}</span></div>`
      },
    },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 56, right: 16, top: 18, bottom: 42 },
    xAxis: {
      type: 'category',
      data: lags.map(String),
      axisLabel: { fontSize: 10, hideOverlap: true },
      name: '滞后步数（Lag）',
      nameTextStyle: { fontSize: 10 },
    },
    yAxis: { type: 'value', name: '自相关系数（ACF）', nameTextStyle: { fontSize: 10 }, min: -1, max: 1, axisLabel: { fontSize: 10 } },
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
