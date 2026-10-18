import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface MapEntry {
  region_id: string
  value: number | null
  group?: number | null
  has_timeseries?: boolean
  label?: string
}

interface Props {
  geojson: any
  entries: MapEntry[]
  colorFor: (entry: MapEntry | undefined) => string
  selected: string[]
  onToggle: (regionId: string) => void
  height?: number
  formatTooltip?: (entry: MapEntry | undefined, regionId: string) => string
  legend?: React.ReactNode
  /** show the region name permanently in the middle of each polygon */
  showLabels?: boolean
  labelFor?: (entry: MapEntry | undefined, regionId: string) => string
  /** region highlighted from an external chart (does not change the selection) */
  focus?: string | null
}

/**
 * Leaflet driven imperatively: the GeoJSON layer is created once per dataset and
 * only styles/tooltips are refreshed afterwards, so clicking never reloads the
 * whole geometry (spec 13.4 GIS caching).
 */
export default function MapView({
  geojson,
  entries,
  colorFor,
  selected,
  onToggle,
  height = 460,
  formatTooltip,
  legend,
  showLabels = false,
  labelFor,
  focus = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.GeoJSON | null>(null)
  const pathsRef = useRef<Record<string, L.Path>>({})
  const valuesRef = useRef<Record<string, MapEntry>>({})
  const toggleRef = useRef(onToggle)
  const colorRef = useRef(colorFor)
  const tooltipRef = useRef(formatTooltip)
  const [ready, setReady] = useState(false)

  toggleRef.current = onToggle
  colorRef.current = colorFor
  tooltipRef.current = formatTooltip

  const entryMap = useMemo(() => {
    const map: Record<string, MapEntry> = {}
    entries.forEach((item) => {
      map[item.region_id] = item
    })
    valuesRef.current = map
    return map
  }, [entries])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
      center: [45.46, 9.19],
      zoom: 10,
    })
    // Standard OSM tiles (no API key / watermark). They are drawn semi
    // transparent so the thematic polygon colours stay readable.
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      opacity: 0.55,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    mapRef.current = map
    setReady(true)
    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
      pathsRef.current = {}
      setReady(false)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !geojson?.features?.length) return
    if (layerRef.current) map.removeLayer(layerRef.current)
    const paths: Record<string, L.Path> = {}
    const layer = L.geoJSON(geojson, {
      style: () => ({ color: '#ffffff', weight: 0.8, fillOpacity: 0.82, fillColor: '#dbe6f6' }),
      onEachFeature: (feature, featureLayer) => {
        const regionId = String(feature.properties?.region_id)
        paths[regionId] = featureLayer as L.Path
        featureLayer.on('click', () => toggleRef.current(regionId))
        featureLayer.on('mouseover', () => {
          const entry = valuesRef.current[regionId]
          const text = tooltipRef.current
            ? tooltipRef.current(entry, regionId)
            : `${regionId}: ${entry?.value ?? '无数据'}`
          featureLayer.bindTooltip(text, { sticky: true }).openTooltip()
        })
        if (showLabels) {
          const entry = valuesRef.current[regionId]
          const label = labelFor ? labelFor(entry, regionId) : regionId
          featureLayer.bindTooltip(label, {
            permanent: true,
            direction: 'center',
            className: 'tn-map-label',
            opacity: 1,
          })
        }
      },
    }).addTo(map)
    layerRef.current = layer
    pathsRef.current = paths
    try {
      const bounds = layer.getBounds()
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [10, 10] })
    } catch {
      /* empty geometry */
    }
  }, [geojson, ready, showLabels])

  useEffect(() => {
    Object.entries(pathsRef.current).forEach(([regionId, path]) => {
      const entry = entryMap[regionId]
      const isSelected = selected.includes(regionId)
      const isFocused = focus === regionId
      path.setStyle({
        fillColor: colorRef.current(entry),
        color: isFocused ? '#D4380D' : isSelected ? '#142B52' : '#ffffff',
        weight: isFocused ? 3 : isSelected ? 2.4 : 0.8,
      })
    })
  }, [entryMap, selected, focus, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    const path = pathsRef.current[focus]
    if (!path) return
    try {
      const bounds = (path as any).getBounds?.()
      if (bounds?.isValid?.()) map.flyToBounds(bounds, { maxZoom: 13, duration: 0.45 })
      ;(path as any).bringToFront?.()
    } catch {
      /* ignore invalid geometry */
    }
  }, [focus, ready, geojson])

  return (
    <div>
      <div ref={containerRef} className="tn-map" style={{ height }} />
      <div className="tn-legend">{legend}</div>
    </div>
  )
}

export function colorScale(value: number | null, min: number, max: number, palette: string[]): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '#c9d3e2'
  if (max - min < 1e-12) return palette[Math.floor(palette.length / 2)]
  const ratio = Math.min(1, Math.max(0, (value - min) / (max - min)))
  return palette[Math.min(palette.length - 1, Math.floor(ratio * palette.length))]
}

export const BLUE_PALETTE = ['#dbeafe', '#a9c8fb', '#77a5f6', '#4a83ef', '#2467E8', '#174ba8']
export const CLUSTER_PALETTE = [
  '#2467E8', '#12A67A', '#D98F00', '#8B5CF6', '#E4572E', '#0E9AA7', '#C2185B', '#5B7095',
]
