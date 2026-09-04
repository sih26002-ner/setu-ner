'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabaseClient'
import { compressImage } from '@/lib/imageUtils'

const LocationPicker = dynamic(() => import('@/components/LocationPicker'), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-gray-800 animate-pulse rounded-lg" />,
})

// All user-facing strings live here -> Week 6 i18n swap touches one object
const LABELS = {
  title: 'Report an Incident',
  locate: 'Use my GPS location',
  locating: 'Getting GPS fix…',
  tapHint: 'Tap the map to correct the pin if GPS has drifted.',
  accuracy: (m) => `GPS accuracy ±${Math.round(m)} m`,
  poorAccuracy: 'Low GPS accuracy - move to open sky or correct the pin on the map.',
  incidentType: 'Incident type',
  severity: 'Severity',
  description: 'Description (optional)',
  photo: 'Photo evidence (optional)',
  submit: 'Submit report',
  submitting: 'Submitting…',
  uploadingPhoto: 'Uploading photo…',
  needLocation: 'Set a location first (GPS or tap the map).',
  newReport: 'File another report',
}

const INCIDENT_TYPES = [
  ['landslide', 'Landslide'], ['flood', 'Flood'], ['road_damage', 'Road damage'],
  ['bridge_damage', 'Bridge damage'], ['traffic_blockage', 'Traffic blockage'],
  ['fallen_tree', 'Fallen tree'], ['other', 'Other'],
]
const SEVERITIES = [['low', 'Low'], ['moderate', 'Moderate'], ['high', 'High'], ['critical', 'Critical']]

const inputClass =
  'w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500'

export default function IncidentReportForm() {
  const router = useRouter()

  const [position, setPosition] = useState(null)     // { lat, lng, source: 'gps' | 'manual' }
  const [accuracy, setAccuracy] = useState(null)
  const [locating, setLocating] = useState(false)
  const [incidentType, setIncidentType] = useState('landslide')
  const [severity, setSeverity] = useState('moderate')
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [phase, setPhase] = useState('idle')           // idle | submitting | uploading | done
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  // One id per report attempt. Retries of the SAME attempt reuse it -> server idempotency.
  const attemptIdRef = useRef(null)
  useEffect(() => {
    attemptIdRef.current = crypto.randomUUID()
  }, [])

  // ---- Geolocation ----
  function locate() {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser.')
      return
    }
    setLocating(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps' })
        setAccuracy(pos.coords.accuracy)
        setLocating(false)
      },
      (err) => {
        const messages = {
          1: 'Location permission denied. Enable it in browser settings, or tap the map to set the pin.',
          2: 'Position unavailable. Try again outdoors, or tap the map.',
          3: 'GPS timed out. Try again, or tap the map.',
        }
        setError(messages[err.code] ?? err.message)
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  function handlePick(p) {
    setPosition(p)
    setAccuracy(null) // a hand-placed pin has no GPS accuracy
  }

  function handlePhoto(e) {
    const file = e.target.files?.[0] ?? null
    setPhoto(file)
    setPhotoPreview(file ? URL.createObjectURL(file) : null)
  }

  // ---- Submit ----
  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!position) {
      setError(LABELS.needLocation)
      return
    }

    setPhase('submitting')
    try {
      // 1. Create the incident (server does auth, validation, road snap, audit, re-score)
      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_type: incidentType,
          severity,
          description: description || undefined,
          latitude: position.lat,
          longitude: position.lng,
          accuracy_meters: accuracy ?? undefined,
          offline_id: attemptIdRef.current,
          reported_at: new Date().toISOString(),
        }),
      })
      const data = await res.json()
      if (!data.success) {
        throw new Error(data.message || data.error || 'Submission failed')
      }

      // 2. Photo: compress -> upload to <user>/<incident>/<file> -> record metadata
      let photoStatus = null
      if (photo) {
        setPhase('uploading')
        try {
          const supabase = createClient()
          const { data: { user } } = await supabase.auth.getUser()
          const compressed = await compressImage(photo)
          const path = `${user.id}/${data.incident.id}/${Date.now()}.jpg`

          const { error: uploadError } = await supabase.storage
            .from('incident-media')
            .upload(path, compressed, { contentType: 'image/jpeg', upsert: false })
          if (uploadError) throw uploadError

          const { error: metaError } = await supabase.from('media_attachments').insert({
            incident_id: data.incident.id,
            uploaded_by: user.id,
            storage_path: path,
            file_name: compressed.name,
            file_size_bytes: compressed.size,
            mime_type: 'image/jpeg',
            capture_lat: position.lat,
            capture_lng: position.lng,
            captured_at: new Date().toISOString(),
          })
          if (metaError) throw metaError

          photoStatus = `Photo attached (${Math.round(compressed.size / 1024)} KB)`
        } catch (photoErr) {
          // The report is already saved - never hide that behind a photo failure
          console.error('Photo upload failed:', photoErr)
          photoStatus = `Report saved, but photo upload failed: ${photoErr.message}`
        }
      }

      setResult({ ...data, photoStatus, pinSource: position.source })
      setPhase('done')
      router.refresh() // re-render the server-side "My reports" list
    } catch (err) {
      setError(err.message)
      setPhase('idle') // same attemptId is kept -> a retry is idempotent
    }
  }

  function resetForm() {
    attemptIdRef.current = crypto.randomUUID()
    setPosition(null); setAccuracy(null); setDescription('')
    setPhoto(null); setPhotoPreview(null); setResult(null); setError(null)
    setIncidentType('landslide'); setSeverity('moderate'); setPhase('idle')
  }

  // ---- Success view ----
  if (phase === 'done' && result) {
    const risk = result.updated_risk
    return (
      <div className="bg-gray-900 border border-green-800 rounded-2xl p-6 space-y-3">
        <h2 className="text-lg font-semibold text-green-400">✓ Report submitted</h2>
        <p className="text-gray-300 text-sm">{result.message}</p>
        {result.nearest_road && (
          <p className="text-gray-400 text-sm">
            Snapped to <span className="text-white">{result.nearest_road.road_name}</span> ·{' '}
            {Math.round(result.nearest_road.distance_m)} m from road
          </p>
        )}
        {risk && (
          <div className="bg-gray-800 rounded-lg p-3 text-sm">
            <p className="text-gray-400">Updated road risk</p>
            <p className="text-2xl font-bold text-white">{Math.round(risk.score * 100)}%</p>
            <p className="text-xs text-gray-500 mt-1">
              weather {risk.factors.weather?.contribution ?? 0} · incidents {risk.factors.incidents?.contribution ?? 0} · infrastructure {risk.factors.infrastructure?.contribution ?? 0}
            </p>
          </div>
        )}
        {result.photoStatus && <p className="text-xs text-gray-400">{result.photoStatus}</p>}
        <p className="text-xs text-gray-500">Pin source: {result.pinSource === 'gps' ? 'device GPS' : 'manually corrected'}</p>
        <button onClick={resetForm} className="mt-2 w-full py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium">
          {LABELS.newReport}
        </button>
      </div>
    )
  }

  // ---- Form view ----
  const busy = phase !== 'idle'
  return (
    <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-5">
      <h2 className="text-lg font-semibold text-white">{LABELS.title}</h2>

      {/* Location */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={locate}
          disabled={locating || busy}
          className="w-full py-2.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 border border-gray-700 rounded-lg text-white text-sm font-medium"
        >
          {locating ? LABELS.locating : `📍 ${LABELS.locate}`}
        </button>
        <div className="h-64 rounded-lg overflow-hidden border border-gray-700">
          <LocationPicker position={position} accuracy={accuracy} onPick={handlePick} />
        </div>
        <p className="text-xs text-gray-500">{LABELS.tapHint}</p>
        {position && (
          <p className="text-xs text-gray-400 font-mono">
            {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
            {accuracy != null && ` · ${LABELS.accuracy(accuracy)}`}
          </p>
        )}
        {accuracy > 100 && <p className="text-xs text-yellow-400">{LABELS.poorAccuracy}</p>}
      </div>

      {/* Type + Severity */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-gray-300 mb-1">{LABELS.incidentType}</label>
          <select value={incidentType} onChange={e => setIncidentType(e.target.value)} className={inputClass} disabled={busy}>
            {INCIDENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-300 mb-1">{LABELS.severity}</label>
          <select value={severity} onChange={e => setSeverity(e.target.value)} className={inputClass} disabled={busy}>
            {SEVERITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm text-gray-300 mb-1">{LABELS.description}</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          maxLength={2000}
          disabled={busy}
          className={inputClass}
          placeholder="What do you see? Lanes affected, vehicles stuck, estimated clearance…"
        />
      </div>

      {/* Photo - capture="environment" opens the rear camera directly on phones */}
      <div>
        <label className="block text-sm text-gray-300 mb-1">{LABELS.photo}</label>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhoto}
          disabled={busy}
          className="block w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-gray-700 file:text-white"
        />
        {photoPreview && <img src={photoPreview} alt="preview" className="mt-2 h-32 rounded-lg object-cover border border-gray-700" />}
      </div>

      {error && (
        <div className="bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <button
        type="submit"
        disabled={busy || !position}
        className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:cursor-not-allowed rounded-lg text-white font-semibold"
      >
        {phase === 'submitting' ? LABELS.submitting : phase === 'uploading' ? LABELS.uploadingPhoto : LABELS.submit}
      </button>
    </form>
  )
}