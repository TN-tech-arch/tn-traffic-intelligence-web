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
