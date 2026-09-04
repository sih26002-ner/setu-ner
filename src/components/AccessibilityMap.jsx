'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import 'leaflet/dist/leaflet.css'

// Dynamically import react-leaflet components with SSR disabled
// This is required because Leaflet uses `window` which doesn't exist on the server
const MapContainer = dynamic(
  () => import('react-leaflet').then(mod => mod.MapContainer),
  { ssr: false }
)
const TileLayer = dynamic(
  () => import('react-leaflet').then(mod => mod.TileLayer),
  { ssr: false }
)
const Polyline = dynamic(
  () => import('react-leaflet').then(mod => mod.Polyline),
  { ssr: false }
)
const Popup = dynamic(
  () => import('react-leaflet').then(mod => mod.Popup),
  { ssr: false }
)

// Risk level to color mapping - visually communicates danger at a glance
const RISK_COLORS = {
  low: '#22c55e',       // green
  moderate: '#eab308',  // yellow
  high: '#f97316',      // orange
  critical: '#ef4444',  // red
}

function getRoadColor(riskLevel, currentStatus) {
  if (currentStatus === 'closed' || currentStatus === 'blocked') return '#ef4444'
  if (currentStatus === 'partially_blocked' || currentStatus === 'under_repair') return '#f97316'
  return RISK_COLORS[riskLevel] || '#3b82f6'
}

export default function AccessibilityMap() {
  const [roads, setRoads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchRoads() {
      try {
        const response = await fetch('/api/map/roads')
        const result = await response.json()

        if (!result.success) {
          throw new Error(result.error || 'Failed to load map data')
        }

        setRoads(result.geojson.features)
      } catch (err) {
        console.error('Failed to fetch road data:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchRoads()
  }, [])

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-gray-900">
        <p className="text-gray-400">Loading NER accessibility map...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-gray-900">
        <p className="text-red-400">Error loading map: {error}</p>
      </div>
    )
  }

  // Center the map roughly on the North Eastern Region of India
  const NER_CENTER = [25.5, 92.5]

  return (
    <MapContainer
      center={NER_CENTER}
      zoom={7}
      style={{ height: '100%', width: '100%' }}
      className="rounded-lg"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {roads.map((road) => {
        // Convert GeoJSON [lng, lat] coordinates to Leaflet's [lat, lng] format
        const positions = road.geometry.coordinates.map(
          ([lng, lat]) => [lat, lng]
        )

        const color = getRoadColor(road.properties.risk_level, road.properties.current_status)

        return (
          <Polyline
            key={road.properties.id}
            positions={positions}
            pathOptions={{ color, weight: 5, opacity: 0.8 }}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-bold text-base mb-1">{road.properties.name}</p>
                <p><span className="font-semibold">District:</span> {road.properties.district_name}, {road.properties.district_state}</p>
                <p><span className="font-semibold">Status:</span> {road.properties.current_status?.replace('_', ' ')}</p>
                <p><span className="font-semibold">Road Type:</span> {road.properties.road_type?.replace('_', ' ')}</p>
                <p><span className="font-semibold">Length:</span> {road.properties.length_km} km</p>
                {road.properties.risk_score !== null && (
                  <>
                    <p className="mt-2">
                      <span className="font-semibold">Risk Score:</span>{' '}
                      <span style={{ color }}>
                        {(road.properties.risk_score * 100).toFixed(0)}% ({road.properties.risk_level})
                      </span>
                    </p>
                  </>
                )}
              </div>
            </Popup>
          </Polyline>
        )
      })}
    </MapContainer>
  )
}