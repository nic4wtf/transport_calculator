import { FormEvent, useEffect, useMemo, useState } from 'react'
import './App.css'

type FuelEfficiencyUnit = 'L_PER_100KM' | 'KM_PER_L'
type Page = 'calculator' | 'assumptions'
type FieldName = 'home' | 'work'

type FormState = {
  home: string
  work: string
  departureTime: string
  workdaysPerWeek: number
  fuelEfficiencyValue: number
  fuelEfficiencyUnit: FuelEfficiencyUnit
  fuelPrice: number
  parkingCost: number
}

type Coordinates = {
  lat: number
  lon: number
  label: string
}

type Suggestion = {
  label: string
  subtitle: string
  value: string
}

type OsrmStep = {
  name?: string
  ref?: string
  destinations?: string
}

type OsrmLeg = {
  steps?: OsrmStep[]
}

type OsrmRoute = {
  distance: number
  duration: number
  legs?: OsrmLeg[]
  geometry?: {
    coordinates: [number, number][]
  }
}

type MapPoint = {
  lat: number
  lon: number
}

type TileImage = {
  key: string
  url: string
  left: number
  top: number
  size: number
}

type CarOption = {
  key: string
  title: string
  routeType: 'fastest' | 'lowest-toll' | 'toll-free'
  distanceKm: number
  durationMinutes: number
  fuelCost: number
  tollCost: number
  parkingCost: number
  totalOneWayCost: number
  tollRoads: string[]
  notes: string[]
  path: MapPoint[]
}

type TransitOption = {
  distanceKm: number
  durationMinutes: number
  fare: number
  fareLabel: string
  transfers: number
  walkingMinutes: number
  notes: string[]
}

type ComparisonResults = {
  car: CarOption[]
  transit: TransitOption
  geocodedHome: string
  geocodedWork: string
  origin: MapPoint
  destination: MapPoint
}

const DEFAULT_FORM: FormState = {
  home: 'Bondi Junction NSW',
  work: 'Sydney CBD NSW',
  departureTime: buildDefaultDepartureTime(),
  workdaysPerWeek: 5,
  fuelEfficiencyValue: 8.5,
  fuelEfficiencyUnit: 'L_PER_100KM',
  fuelPrice: 2.05,
  parkingCost: 18,
}

const SYDNEY_TOLL_CAPS: Array<{ key: string; label: string; cap: number; tokens: string[] }> = [
  { key: 'eastern-distributor', label: 'Eastern Distributor', cap: 10.37, tokens: ['eastern distributor'] },
  { key: 'cross-city-tunnel', label: 'Cross City Tunnel', cap: 7.31, tokens: ['cross city tunnel'] },
  { key: 'lane-cove-tunnel', label: 'Lane Cove Tunnel', cap: 4.24, tokens: ['lane cove tunnel'] },
  { key: 'hills-m2', label: 'Hills M2', cap: 10.49, tokens: ['hills m2', ' m2 ', 'm2 motorway'] },
  { key: 'northconnex', label: 'NorthConnex', cap: 10.49, tokens: ['northconnex'] },
  { key: 'westlink-m7', label: 'Westlink M7', cap: 10.36, tokens: ['westlink m7', ' m7 '] },
  { key: 'm5-south-west', label: 'M5 South-West', cap: 5.98, tokens: ['m5 south-west', ' m5 '] },
  { key: 'westconnex', label: 'WestConnex', cap: 12.74, tokens: ['westconnex', 'm4-m8', ' m8 ', 'm5 east', 'rozelle'] },
]

const TRANSIT_FARE_BANDS = [
  { maxDistanceKm: 10, peakFare: 4.62, offPeakFare: 3.78 },
  { maxDistanceKm: 20, peakFare: 5.94, offPeakFare: 4.86 },
  { maxDistanceKm: 35, peakFare: 7.37, offPeakFare: 6.03 },
  { maxDistanceKm: Number.POSITIVE_INFINITY, peakFare: 9.13, offPeakFare: 7.47 },
]

const TRANSIT_TRANSFER_RULES = [
  { maxDistanceKm: 7, transfers: 0, walkingMinutes: 10 },
  { maxDistanceKm: 22, transfers: 1, walkingMinutes: 12 },
  { maxDistanceKm: Number.POSITIVE_INFINITY, transfers: 2, walkingMinutes: 15 },
]

function buildDefaultDepartureTime(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  const date = local.toISOString().slice(0, 10)
  return `${date}T08:30`
}

function getPageFromHash(): Page {
  return window.location.hash === '#assumptions' ? 'assumptions' : 'calculator'
}

function formatCurrency(amount: number, currencyCode = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return '0 min'
  }

  const rounded = Math.round(minutes)
  const hours = Math.floor(rounded / 60)
  const remainingMinutes = rounded % 60

  if (hours === 0) {
    return `${remainingMinutes} min`
  }

  if (remainingMinutes === 0) {
    return `${hours} hr`
  }

  return `${hours} hr ${remainingMinutes} min`
}

function convertFuelEfficiency(value: number, from: FuelEfficiencyUnit, to: FuelEfficiencyUnit): number {
  if (value <= 0 || from === to) {
    return value
  }

  return 100 / value
}

function fuelEfficiencyToLitersPer100Km(value: number, unit: FuelEfficiencyUnit): number {
  if (value <= 0) {
    return 0
  }

  return unit === 'L_PER_100KM' ? value : 100 / value
}

function formatFuelUnit(unit: FuelEfficiencyUnit): string {
  return unit === 'L_PER_100KM' ? 'L/100km' : 'km/L'
}

function calculateCarReturnCost(option: CarOption): number {
  return option.fuelCost * 2 + option.tollCost * 2 + option.parkingCost
}

function calculateTransitReturnCost(option: TransitOption): number {
  return option.fare * 2
}

function calculateFuelCost(distanceKm: number, litersPer100Km: number, fuelPrice: number): number {
  const litersUsed = (distanceKm * litersPer100Km) / 100
  return litersUsed * fuelPrice
}

function haversineKm(origin: Coordinates, destination: Coordinates): number {
  const earthRadiusKm = 6371
  const latDelta = toRadians(destination.lat - origin.lat)
  const lonDelta = toRadians(destination.lon - origin.lon)
  const originLat = toRadians(origin.lat)
  const destinationLat = toRadians(destination.lat)
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(originLat) * Math.cos(destinationLat) * Math.sin(lonDelta / 2) ** 2

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function lonToWorldX(lon: number, zoom: number): number {
  const scale = 256 * 2 ** zoom
  return ((lon + 180) / 360) * scale
}

function latToWorldY(lat: number, zoom: number): number {
  const scale = 256 * 2 ** zoom
  const sinLat = Math.sin(toRadians(clamp(lat, -85.0511, 85.0511)))
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)
  return y * scale
}

function getTileLayout(points: MapPoint[], width: number, height: number): {
  zoom: number
  minWorldX: number
  minWorldY: number
  tiles: TileImage[]
} {
  const minLat = Math.min(...points.map((point) => point.lat))
  const maxLat = Math.max(...points.map((point) => point.lat))
  const minLon = Math.min(...points.map((point) => point.lon))
  const maxLon = Math.max(...points.map((point) => point.lon))
  const latPadding = Math.max((maxLat - minLat) * 0.18, 0.01)
  const lonPadding = Math.max((maxLon - minLon) * 0.18, 0.01)
  const bounds = {
    minLat: minLat - latPadding,
    maxLat: maxLat + latPadding,
    minLon: minLon - lonPadding,
    maxLon: maxLon + lonPadding,
  }

  let selectedZoom = 12

  for (let zoom = 16; zoom >= 8; zoom -= 1) {
    const projectedWidth = lonToWorldX(bounds.maxLon, zoom) - lonToWorldX(bounds.minLon, zoom)
    const projectedHeight = latToWorldY(bounds.minLat, zoom) - latToWorldY(bounds.maxLat, zoom)

    if (projectedWidth <= width * 0.88 && projectedHeight <= height * 0.88) {
      selectedZoom = zoom
      break
    }
  }

  const minWorldX = lonToWorldX(bounds.minLon, selectedZoom)
  const maxWorldX = lonToWorldX(bounds.maxLon, selectedZoom)
  const minWorldY = latToWorldY(bounds.maxLat, selectedZoom)
  const maxWorldY = latToWorldY(bounds.minLat, selectedZoom)
  const startTileX = Math.floor(minWorldX / 256)
  const endTileX = Math.floor(maxWorldX / 256)
  const startTileY = Math.floor(minWorldY / 256)
  const endTileY = Math.floor(maxWorldY / 256)
  const maxTileIndex = 2 ** selectedZoom - 1
  const tiles: TileImage[] = []

  for (let tileX = startTileX; tileX <= endTileX; tileX += 1) {
    for (let tileY = startTileY; tileY <= endTileY; tileY += 1) {
      const wrappedX = ((tileX % (maxTileIndex + 1)) + (maxTileIndex + 1)) % (maxTileIndex + 1)
      if (tileY < 0 || tileY > maxTileIndex) {
        continue
      }

      tiles.push({
        key: `${selectedZoom}-${wrappedX}-${tileY}`,
        url: `https://tile.openstreetmap.org/${selectedZoom}/${wrappedX}/${tileY}.png`,
        left: tileX * 256 - minWorldX,
        top: tileY * 256 - minWorldY,
        size: 256,
      })
    }
  }

  return { zoom: selectedZoom, minWorldX, minWorldY, tiles }
}

function isPeakSydneyCommute(departureTime: string): boolean {
  const date = new Date(departureTime)
  if (Number.isNaN(date.getTime())) {
    return true
  }

  const totalMinutes = date.getHours() * 60 + date.getMinutes()
  const morningPeak = totalMinutes >= 390 && totalMinutes <= 600
  const afternoonPeak = totalMinutes >= 900 && totalMinutes <= 1140
  return morningPeak || afternoonPeak
}

async function geocodeAddress(query: string): Promise<Coordinates> {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=au&q=${encodeURIComponent(query)}`,
  )

  if (!response.ok) {
    throw new Error(`Geocoding failed for "${query}".`)
  }

  const payload = (await response.json()) as Array<{ lat: string; lon: string; display_name: string }>
  if (payload.length === 0) {
    throw new Error(`No Sydney-area match found for "${query}".`)
  }

  return {
    lat: Number(payload[0].lat),
    lon: Number(payload[0].lon),
    label: payload[0].display_name,
  }
}

async function fetchSuburbSuggestions(query: string): Promise<Suggestion[]> {
  const cleaned = query.trim()
  if (cleaned.length < 2) {
    return []
  }

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=au&q=${encodeURIComponent(`${cleaned}, Sydney NSW`)}`,
  )

  if (!response.ok) {
    return []
  }

  const payload = (await response.json()) as Array<{
    display_name: string
    address?: Record<string, string>
  }>

  return payload.map((item) => {
    const suburb =
      item.address?.suburb ??
      item.address?.town ??
      item.address?.city_district ??
      item.address?.neighbourhood ??
      item.address?.city ??
      item.display_name.split(',')[0]

    const state = item.address?.state ?? 'NSW'
    const postcode = item.address?.postcode ? ` ${item.address.postcode}` : ''
    return {
      label: suburb,
      subtitle: `${state}${postcode}`,
      value: `${suburb} NSW`,
    }
  })
}

async function fetchDrivingRoutes(origin: Coordinates, destination: Coordinates): Promise<OsrmRoute[]> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}` +
    '?alternatives=3&steps=true&overview=full&geometries=geojson'

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Driving route lookup failed.')
  }

  const payload = (await response.json()) as { routes?: OsrmRoute[] }
  if (!payload.routes || payload.routes.length === 0) {
    throw new Error('No driving routes were returned for this trip.')
  }

  return payload.routes
}

function detectSydneyTollRoads(route: OsrmRoute): Array<{ key: string; label: string; cap: number }> {
  const roadText = route.legs
    ?.flatMap((leg) => leg.steps ?? [])
    .map((step) => `${step.name ?? ''} ${step.ref ?? ''} ${step.destinations ?? ''}`.toLowerCase())
    .join(' | ') ?? ''

  const paddedText = ` ${roadText} `
  return SYDNEY_TOLL_CAPS.filter((road) =>
    road.tokens.some((token) => paddedText.includes(token.toLowerCase())),
  ).map(({ key, label, cap }) => ({ key, label, cap }))
}

function buildCarOption(
  key: string,
  title: string,
  routeType: CarOption['routeType'],
  route: OsrmRoute,
  parkingCost: number,
  fuelEfficiency: number,
  fuelPrice: number,
): CarOption {
  const distanceKm = route.distance / 1000
  const durationMinutes = route.duration / 60
  const detectedTolls = detectSydneyTollRoads(route)
  const tollCost = detectedTolls.reduce((total, road) => total + road.cap, 0)
  const fuelCost = calculateFuelCost(distanceKm, fuelEfficiency, fuelPrice)
  const totalOneWayCost = fuelCost + tollCost + parkingCost

  return {
    key,
    title,
    routeType,
    distanceKm,
    durationMinutes,
    fuelCost,
    tollCost,
    parkingCost,
    totalOneWayCost,
    tollRoads: detectedTolls.map((road) => road.label),
    notes: detectedTolls.length
      ? ['Tolls are estimated from detected Sydney toll roads using public passenger-vehicle caps.']
      : ['No Sydney toll road was detected on this route.'],
    path: route.geometry?.coordinates.map(([lon, lat]) => ({ lat, lon })) ?? [],
  }
}

function buildTransitOption(
  origin: Coordinates,
  destination: Coordinates,
  referenceCarRoute: CarOption,
  departureTime: string,
): TransitOption {
  const straightLineDistance = haversineKm(origin, destination)
  const peak = isPeakSydneyCommute(departureTime)
  const transitDistanceKm = Math.max(straightLineDistance * 1.35, referenceCarRoute.distanceKm * 1.08)
  const transferRule = TRANSIT_TRANSFER_RULES.find((rule) => transitDistanceKm <= rule.maxDistanceKm) ?? TRANSIT_TRANSFER_RULES[2]
  const waitMinutes = peak ? 6 : 10
  const transferPenalty = transferRule.transfers * (peak ? 7 : 9)
  const inVehicleSpeedKmh = peak ? 25 : 29
  const inVehicleMinutes = (transitDistanceKm / inVehicleSpeedKmh) * 60
  const durationMinutes = inVehicleMinutes + transferRule.walkingMinutes + waitMinutes + transferPenalty
  const fareBand = TRANSIT_FARE_BANDS.find((band) => transitDistanceKm <= band.maxDistanceKm) ?? TRANSIT_FARE_BANDS[3]
  const fare = peak ? fareBand.peakFare : fareBand.offPeakFare

  return {
    distanceKm: transitDistanceKm,
    durationMinutes,
    fare,
    fareLabel: `${formatCurrency(fare)} estimated`,
    transfers: transferRule.transfers,
    walkingMinutes: transferRule.walkingMinutes,
    notes: [
      'Transit is estimated from Sydney commute heuristics, not a live timetable feed.',
      'Use this for rough comparison rather than precise journey planning.',
    ],
  }
}

async function computeResults(form: FormState): Promise<ComparisonResults> {
  const [origin, destination] = await Promise.all([geocodeAddress(form.home), geocodeAddress(form.work)])
  const routes = await fetchDrivingRoutes(origin, destination)
  const litersPer100Km = fuelEfficiencyToLitersPer100Km(form.fuelEfficiencyValue, form.fuelEfficiencyUnit)

  const carRoutes = routes.map((route, index) =>
    buildCarOption(`route-${index}`, `Drive option ${index + 1}`, 'fastest', route, form.parkingCost, litersPer100Km, form.fuelPrice),
  )

  const fastest = [...carRoutes].sort((left, right) => left.durationMinutes - right.durationMinutes)[0]
  const lowestToll = [...carRoutes].sort((left, right) => {
    if (left.tollCost !== right.tollCost) {
      return left.tollCost - right.tollCost
    }

    return left.durationMinutes - right.durationMinutes
  })[0]
  const tollFree = [...carRoutes].filter((route) => route.tollCost === 0).sort((left, right) => left.durationMinutes - right.durationMinutes)[0]

  const car: CarOption[] = [
    { ...fastest, key: 'fastest', title: 'Fastest drive', routeType: 'fastest' },
    { ...lowestToll, key: 'lowest-toll', title: 'Lower-toll drive', routeType: 'lowest-toll' },
  ]

  if (tollFree) {
    car.push({ ...tollFree, key: 'toll-free', title: 'Toll-free drive', routeType: 'toll-free' })
  }

  const transit = buildTransitOption(origin, destination, fastest, form.departureTime)

  return {
    car,
    transit,
    geocodedHome: origin.label,
    geocodedWork: destination.label,
    origin: { lat: origin.lat, lon: origin.lon },
    destination: { lat: destination.lat, lon: destination.lon },
  }
}

function renderRouteMap(options: CarOption[], origin: MapPoint, destination: MapPoint): JSX.Element | null {
  const routeColors: Record<CarOption['routeType'], string> = {
    fastest: '#0b86a5',
    'lowest-toll': '#1550b4',
    'toll-free': '#eb6f24',
  }

  const allPoints = [origin, destination, ...options.flatMap((option) => option.path)]
  if (allPoints.length < 2) {
    return null
  }

  const width = 920
  const height = 360
  const tileLayout = getTileLayout(allPoints, width, height)
  const project = (point: MapPoint) => ({
    x: lonToWorldX(point.lon, tileLayout.zoom) - tileLayout.minWorldX,
    y: latToWorldY(point.lat, tileLayout.zoom) - tileLayout.minWorldY,
  })

  return (
    <div className="route-map-shell">
      <div className="route-map-frame" role="img" aria-label="Route comparison map">
        <div className="route-map-tiles">
          {tileLayout.tiles.map((tile) => (
            <img
              key={tile.key}
              className="route-map-tile"
              src={tile.url}
              alt=""
              loading="lazy"
              width={tile.size}
              height={tile.size}
              style={{ left: `${tile.left}px`, top: `${tile.top}px` }}
            />
          ))}
        </div>
        <svg className="route-map-overlay" viewBox={`0 0 ${width} ${height}`}>
          <rect width={width} height={height} fill="rgba(255,255,255,0.08)" />
          {options.map((option) => {
            if (option.path.length === 0) {
              return null
            }

            const points = option.path.map((point) => {
              const projected = project(point)
              return `${projected.x},${projected.y}`
            }).join(' ')

            return (
              <polyline
                key={option.key}
                points={points}
                fill="none"
                stroke={routeColors[option.routeType]}
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.88"
              />
            )
          })}
          {(() => {
            const projected = project(origin)
            return (
              <g>
                <circle cx={projected.x} cy={projected.y} r="9" fill="#13663f" />
                <circle cx={projected.x} cy={projected.y} r="15" fill="rgba(19,102,63,0.14)" />
              </g>
            )
          })()}
          {(() => {
            const projected = project(destination)
            return (
              <g>
                <rect x={projected.x - 8} y={projected.y - 8} width="16" height="16" rx="4" fill="#9c2d41" />
                <rect x={projected.x - 13} y={projected.y - 13} width="26" height="26" rx="8" fill="rgba(156,45,65,0.14)" />
              </g>
            )
          })()}
        </svg>
      </div>
      <div className="map-legend">
        {options.map((option) => (
          <div className="legend-item" key={option.key}>
            <span className="legend-swatch" style={{ backgroundColor: routeColors[option.routeType] }} />
            <span>{option.title}</span>
          </div>
        ))}
        <div className="legend-item">
          <span className="legend-marker origin" />
          <span>Home</span>
        </div>
        <div className="legend-item">
          <span className="legend-marker destination" />
          <span>Work</span>
        </div>
      </div>
    </div>
  )
}

function SuburbAutocompleteField(props: {
  label: string
  value: string
  suggestions: Suggestion[]
  placeholder: string
  onChange: (value: string) => void
  onFocus: () => void
  onBlur: () => void
  onSelect: (value: string) => void
}) {
  const { label, value, suggestions, placeholder, onChange, onFocus, onBlur, onSelect } = props

  return (
    <label className="autocomplete-field">
      {label}
      <div className="autocomplete-shell">
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete="off"
        />
        {suggestions.length > 0 ? (
          <div className="autocomplete-menu">
            {suggestions.map((suggestion) => (
              <button
                className="autocomplete-option"
                key={`${suggestion.label}-${suggestion.subtitle}`}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(suggestion.value)}
              >
                <span>{suggestion.label}</span>
                <small>{suggestion.subtitle}</small>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </label>
  )
}

function AssumptionsPage() {
  return (
    <section className="panel assumptions-page">
      <div className="panel-heading">
        <div>
          <h2>Calculator Assumptions</h2>
          <p>This page shows the fixed numbers and rules used by the current Sydney commute calculator.</p>
        </div>
      </div>

      <div className="assumption-grid">
        <article className="assumption-card">
          <h3>Car Cost Formula</h3>
          <p>`one-way car cost = fuel + tolls + parking`</p>
          <p>`return car cost = fuel x 2 + tolls x 2 + parking`</p>
          <p>Fuel is derived from trip distance, your selected efficiency unit, and price per litre.</p>
        </article>

        <article className="assumption-card">
          <h3>Transit Cost Formula</h3>
          <p>`one-way transit cost = estimated fare`</p>
          <p>`return transit cost = estimated fare x 2`</p>
          <p>Transit uses fixed Sydney-style heuristic bands rather than live timetable or Opal APIs.</p>
        </article>
      </div>

      <div className="assumption-section">
        <h3>Sydney Toll Caps Used</h3>
        <div className="assumption-table">
          <div className="assumption-row assumption-header">
            <span>Toll road</span>
            <span>Passenger cap</span>
          </div>
          {SYDNEY_TOLL_CAPS.map((road) => (
            <div className="assumption-row" key={road.key}>
              <span>{road.label}</span>
              <span>{formatCurrency(road.cap)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="assumption-section">
        <h3>Transit Fare Bands Used</h3>
        <div className="assumption-table">
          <div className="assumption-row assumption-header">
            <span>Estimated trip distance</span>
            <span>Peak fare</span>
            <span>Off-peak fare</span>
          </div>
          {TRANSIT_FARE_BANDS.map((band, index) => (
            <div className="assumption-row" key={`${band.maxDistanceKm}-${index}`}>
              <span>{band.maxDistanceKm === Number.POSITIVE_INFINITY ? '35+ km' : `Up to ${band.maxDistanceKm} km`}</span>
              <span>{formatCurrency(band.peakFare)}</span>
              <span>{formatCurrency(band.offPeakFare)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="assumption-section">
        <h3>Transit Timing Heuristics</h3>
        <div className="assumption-table">
          <div className="assumption-row assumption-header">
            <span>Estimated trip distance</span>
            <span>Transfers</span>
            <span>Walking time</span>
          </div>
          {TRANSIT_TRANSFER_RULES.map((rule, index) => (
            <div className="assumption-row" key={`${rule.maxDistanceKm}-${index}`}>
              <span>{rule.maxDistanceKm === Number.POSITIVE_INFINITY ? '22+ km' : `Up to ${rule.maxDistanceKm} km`}</span>
              <span>{rule.transfers}</span>
              <span>{formatMinutes(rule.walkingMinutes)}</span>
            </div>
          ))}
        </div>
        <p className="assumption-note">Peak periods are treated as 6:30-10:00 and 15:00-19:00 Sydney local time.</p>
        <p className="assumption-note">In-vehicle transit speed is estimated at 25 km/h in peak and 29 km/h off-peak.</p>
      </div>
    </section>
  )
}

function App() {
  const [page, setPage] = useState<Page>(getPageFromHash())
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [results, setResults] = useState<ComparisonResults | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [homeSuggestions, setHomeSuggestions] = useState<Suggestion[]>([])
  const [workSuggestions, setWorkSuggestions] = useState<Suggestion[]>([])
  const [activeField, setActiveField] = useState<FieldName | null>(null)

  useEffect(() => {
    const syncPage = () => setPage(getPageFromHash())
    window.addEventListener('hashchange', syncPage)
    return () => window.removeEventListener('hashchange', syncPage)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchSuburbSuggestions(form.home).then((suggestions) => {
        if (activeField === 'home') {
          setHomeSuggestions(suggestions)
        }
      })
    }, 220)

    return () => window.clearTimeout(timer)
  }, [activeField, form.home])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchSuburbSuggestions(form.work).then((suggestions) => {
        if (activeField === 'work') {
          setWorkSuggestions(suggestions)
        }
      })
    }, 220)

    return () => window.clearTimeout(timer)
  }, [activeField, form.work])

  const canSubmit = Boolean(
    form.home.trim() &&
      form.work.trim() &&
      form.fuelEfficiencyValue > 0 &&
      form.fuelPrice > 0 &&
      form.workdaysPerWeek > 0,
  )

  const summary = useMemo(() => {
    if (!results) {
      return null
    }

    const bestCar = [...results.car].sort((left, right) => left.totalOneWayCost - right.totalOneWayCost)[0]
    const weeklyTrips = form.workdaysPerWeek
    const workWeeksPerYear = 52
    const carReturnCost = calculateCarReturnCost(bestCar)
    const transitReturnCost = calculateTransitReturnCost(results.transit)
    const carWeekly = carReturnCost * weeklyTrips
    const carMonthly = (carWeekly * workWeeksPerYear) / 12
    const carYearly = carWeekly * workWeeksPerYear
    const transitWeekly = transitReturnCost * weeklyTrips
    const transitMonthly = (transitWeekly * workWeeksPerYear) / 12
    const transitYearly = transitWeekly * workWeeksPerYear

    return {
      bestCar,
      carReturnCost,
      carWeekly,
      carMonthly,
      carYearly,
      transitReturnCost,
      transitWeekly,
      transitMonthly,
      transitYearly,
    }
  }, [form.workdaysPerWeek, results])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('loading')
    setErrorMessage(null)

    try {
      const nextResults = await computeResults(form)
      setResults(nextResults)
      setStatus('ready')
    } catch (error) {
      setResults(null)
      setStatus('error')
      setErrorMessage(error instanceof Error ? error.message : 'Something went wrong while calculating the commute.')
    }
  }

  function navigateTo(nextPage: Page) {
    window.location.hash = nextPage === 'assumptions' ? 'assumptions' : ''
    setPage(nextPage)
  }

  const activeSuggestions = activeField === 'home' ? homeSuggestions : activeField === 'work' ? workSuggestions : []

  return (
    <main className="app-shell">
      <header className="top-nav">
        <button className={`nav-link ${page === 'calculator' ? 'active' : ''}`} type="button" onClick={() => navigateTo('calculator')}>
          Calculator
        </button>
        <button className={`nav-link ${page === 'assumptions' ? 'active' : ''}`} type="button" onClick={() => navigateTo('assumptions')}>
          Assumptions & Numbers
        </button>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Sydney Commute Calculator</p>
          <h1>Compare drive costs and public transport without an API key.</h1>
          <p className="hero-text">
            This finalized version runs entirely in the browser using free public routing and geocoding services. Car
            results are live. Public transport is presented as a Sydney-specific estimate so the app stays usable with
            zero setup.
          </p>
        </div>
        <div className="hero-note">
          <p>Data sources</p>
          <strong>OSRM + Nominatim</strong>
          <span>Driving distance and travel time are fetched live. Transit and toll totals are clearly marked as estimates.</span>
        </div>
      </section>

      {page === 'assumptions' ? (
        <AssumptionsPage />
      ) : (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Trip inputs</h2>
                <p>Enter a Sydney home and work location, then compare car cost against an estimated transit commute.</p>
              </div>
              <div className="status-pill ready">No key required</div>
            </div>

            {errorMessage && status !== 'ready' ? (
              <div className="callout error">
                <strong>Calculation failed.</strong>
                <span>{errorMessage}</span>
              </div>
            ) : null}

            <form className="trip-form" onSubmit={handleSubmit}>
              <SuburbAutocompleteField
                label="Home"
                value={form.home}
                suggestions={activeField === 'home' ? activeSuggestions : []}
                placeholder="e.g. Bondi Junction NSW"
                onChange={(value) => setForm((current) => ({ ...current, home: value }))}
                onFocus={() => setActiveField('home')}
                onBlur={() => window.setTimeout(() => setActiveField(null), 120)}
                onSelect={(value) => {
                  setForm((current) => ({ ...current, home: value }))
                  setHomeSuggestions([])
                  setActiveField(null)
                }}
              />

              <SuburbAutocompleteField
                label="Work"
                value={form.work}
                suggestions={activeField === 'work' ? activeSuggestions : []}
                placeholder="e.g. Sydney CBD NSW"
                onChange={(value) => setForm((current) => ({ ...current, work: value }))}
                onFocus={() => setActiveField('work')}
                onBlur={() => window.setTimeout(() => setActiveField(null), 120)}
                onSelect={(value) => {
                  setForm((current) => ({ ...current, work: value }))
                  setWorkSuggestions([])
                  setActiveField(null)
                }}
              />

              <label>
                Departure time
                <input
                  type="datetime-local"
                  value={form.departureTime}
                  onChange={(event) => setForm((current) => ({ ...current, departureTime: event.target.value }))}
                />
              </label>

              <label>
                Workdays per week
                <input
                  type="number"
                  min="1"
                  max="7"
                  step="1"
                  value={form.workdaysPerWeek}
                  onChange={(event) => setForm((current) => ({ ...current, workdaysPerWeek: Number(event.target.value) || 0 }))}
                />
              </label>

              <label>
                Fuel efficiency
                <div className="unit-input-row">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={form.fuelEfficiencyValue}
                    onChange={(event) => setForm((current) => ({ ...current, fuelEfficiencyValue: Number(event.target.value) || 0 }))}
                  />
                  <select
                    value={form.fuelEfficiencyUnit}
                    onChange={(event) =>
                      setForm((current) => {
                        const nextUnit = event.target.value as FuelEfficiencyUnit
                        const convertedValue = convertFuelEfficiency(current.fuelEfficiencyValue, current.fuelEfficiencyUnit, nextUnit)
                        return {
                          ...current,
                          fuelEfficiencyUnit: nextUnit,
                          fuelEfficiencyValue: Number.isFinite(convertedValue) ? Number(convertedValue.toFixed(2)) : current.fuelEfficiencyValue,
                        }
                      })
                    }
                  >
                    <option value="L_PER_100KM">L/100km</option>
                    <option value="KM_PER_L">km/L</option>
                  </select>
                </div>
              </label>

              <label>
                Fuel price (AUD/L)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.fuelPrice}
                  onChange={(event) => setForm((current) => ({ ...current, fuelPrice: Number(event.target.value) || 0 }))}
                />
              </label>

              <label>
                Parking cost per day
                <input
                  type="number"
                  min="0"
                  step="0.50"
                  value={form.parkingCost}
                  onChange={(event) => setForm((current) => ({ ...current, parkingCost: Number(event.target.value) || 0 }))}
                />
              </label>

              <button className="primary-button" type="submit" disabled={!canSubmit || status === 'loading'}>
                {status === 'loading' ? 'Calculating commute...' : 'Compare commute options'}
              </button>
            </form>
          </section>

          {status === 'loading' ? (
            <section className="panel loading-panel" aria-live="polite" aria-busy="true">
              <div className="loading-spinner" />
              <h2>Calculating</h2>
              <p>Matching Sydney addresses, tracing route options, and comparing one-way and return commute costs.</p>
            </section>
          ) : null}

          {results ? (
            <>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Route map</h2>
                    <p>The map overlays the returned driving alternatives so you can see where the faster and lower-toll routes diverge.</p>
                  </div>
                </div>
                {renderRouteMap(results.car, results.origin, results.destination)}
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Matched places</h2>
                    <p>The app geocodes each address to a single Australian location before comparing routes.</p>
                  </div>
                </div>
                <div className="detail-list">
                  <div>Home match: {results.geocodedHome}</div>
                  <div>Work match: {results.geocodedWork}</div>
                </div>
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Car options</h2>
                    <p>Driving routes come from OSRM alternatives. Tolls are estimated by detecting Sydney toll roads in the route steps.</p>
                  </div>
                </div>

                <div className="card-grid">
                  {results.car.map((option) => (
                    <article className="result-card" key={option.key}>
                      <div className="card-topline">{option.title}</div>
                      <div className="metric-row">
                        <span>One-way cost</span>
                        <strong>{formatCurrency(option.totalOneWayCost)}</strong>
                      </div>
                      <div className="metric-row">
                        <span>Return cost</span>
                        <strong>{formatCurrency(calculateCarReturnCost(option))}</strong>
                      </div>
                      <div className="metric-row">
                        <span>Travel time</span>
                        <strong>{formatMinutes(option.durationMinutes)}</strong>
                      </div>
                      <div className="metric-row">
                        <span>Distance</span>
                        <strong>{option.distanceKm.toFixed(1)} km</strong>
                      </div>
                      <div className="detail-list">
                        <div>Fuel: {formatCurrency(option.fuelCost)}</div>
                        <div>Tolls: {formatCurrency(option.tollCost)} estimated</div>
                        <div>Parking: {formatCurrency(option.parkingCost)}</div>
                        <div>Toll roads: {option.tollRoads.length > 0 ? option.tollRoads.join(', ') : 'None detected'}</div>
                        <div>Efficiency: {form.fuelEfficiencyValue} {formatFuelUnit(form.fuelEfficiencyUnit)}</div>
                      </div>
                      <p className="warning-text">{option.notes[0]}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Public transport</h2>
                    <p>The app estimates a Sydney-style transit commute based on trip length, peak timing, and transfer overhead.</p>
                  </div>
                </div>

                <article className="transit-card">
                  <div className="metric-row">
                    <span>One-way fare</span>
                    <strong>{results.transit.fareLabel}</strong>
                  </div>
                  <div className="metric-row">
                    <span>Return cost</span>
                    <strong>{formatCurrency(calculateTransitReturnCost(results.transit))} estimated</strong>
                  </div>
                  <div className="metric-row">
                    <span>Travel time</span>
                    <strong>{formatMinutes(results.transit.durationMinutes)}</strong>
                  </div>
                  <div className="metric-row">
                    <span>Transit distance</span>
                    <strong>{results.transit.distanceKm.toFixed(1)} km</strong>
                  </div>
                  <div className="detail-list">
                    <div>Transfers: {results.transit.transfers}</div>
                    <div>Walking: {formatMinutes(results.transit.walkingMinutes)}</div>
                  </div>
                  {results.transit.notes.map((note) => (
                    <p className="warning-text" key={note}>
                      {note}
                    </p>
                  ))}
                </article>
              </section>

              {summary ? (
                <section className="panel accent">
                  <div className="panel-heading">
                    <div>
                      <h2>Commute summary</h2>
                      <p>Driving counts parking once per workday. Both modes are doubled for a return commute.</p>
                    </div>
                  </div>

                  <div className="summary-grid">
                    <article className="summary-card">
                      <p>Best-value car option</p>
                      <strong>{summary.bestCar.title}</strong>
                      <span>Return day: {formatCurrency(summary.carReturnCost)}</span>
                      <span>Weekly: {formatCurrency(summary.carWeekly)}</span>
                      <span>Monthly: {formatCurrency(summary.carMonthly)}</span>
                      <span>Yearly: {formatCurrency(summary.carYearly)}</span>
                    </article>

                    <article className="summary-card">
                      <p>Estimated public transport</p>
                      <strong>{formatCurrency(results.transit.fare)} one way</strong>
                      <span>Return day: {formatCurrency(summary.transitReturnCost)}</span>
                      <span>Weekly: {formatCurrency(summary.transitWeekly)}</span>
                      <span>Monthly: {formatCurrency(summary.transitMonthly)}</span>
                      <span>Yearly: {formatCurrency(summary.transitYearly)}</span>
                    </article>
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </main>
  )
}

export default App
