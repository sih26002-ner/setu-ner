'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Circle, useMapEvents, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const DEFAULT_CENTER = [25.5788, 91.8854] // Shillong - the test officer's district

// Tap anywhere on the map to move the pin
function TapToPick({ onPick }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng, source: 'manual' })
    },
  })
  return null
}

// Fly to the position ONLY when it came from a GPS fix.
// Recentering on every manual tap would fight the user.
function FollowGpsFix({ position }) {
  const map = useMap()
  useEffect(() => {
    if (position?.source === 'gps') {
      map.setView([position.lat, position.lng], Math.max(map.getZoom(), 15))
    }
  }, [position?.lat, position?.lng, position?.source, map])
  return null
}

export default function LocationPicker({ position, accuracy, onPick }) {
  const center = position ? [position.lat, position.lng] : DEFAULT_CENTER

  return (
    <MapContainer center={center} zoom={position ? 15 : 9} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <TapToPick onPick={onPick} />
      <FollowGpsFix position={position} />

      {/* Accuracy radius - visible honesty about GPS quality */}
      {position && accuracy > 0 && (
        <Circle
          center={center}
          radius={accuracy}
          pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 1 }}
        />
      )}

      {/* The pin. CircleMarker avoids Leaflet's broken default-icon-URL problem under bundlers */}
      {position && (
        <CircleMarker
          center={center}
          radius={9}
          pathOptions={{
            color: '#ffffff',
            weight: 2,
            fillColor: position.source === 'gps' ? '#22c55e' : '#f97316',
            fillOpacity: 1,
          }}
        />
      )}
    </MapContainer>
  )
}