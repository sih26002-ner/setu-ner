// SETU-NER Rule-Based Risk Engine (v1)
// Explainable, weighted scoring per road segment.
// Imported by: /api/admin/compute-risks (all roads) and /api/incidents (one road).

const WEIGHTS = { weather: 0.4, incidents: 0.4, infrastructure: 0.2 }
const BASELINE_RISK = 0.1
const SCORE_TTL_MS = 60 * 60 * 1000          // scores valid for 1 hour
const WEATHER_MAX_AGE_MS = 2 * 60 * 60 * 1000 // ignore weather older than 2 hours

const INFRA_RISK_BY_STATUS = {
  closed: 1.0,
  blocked: 0.8,
  partially_blocked: 0.8,
  under_repair: 0.4,
  open: 0,
}

function incidentRiskFor(incidents) {
  if (incidents.length === 0) return 0
  const severe = incidents.some(i => i.severity === 'critical' || i.severity === 'high')
  if (severe) return 1.0
  if (incidents.length > 1) return 0.6
  return 0.3
}

/**
 * Compute and persist risk scores.
 * @param {object} supabaseAdmin  - service-role client (bypasses RLS; server-only)
 * @param {object} [opts]
 * @param {string[]} [opts.roadIds] - restrict to these road segment ids (default: all)
 * @returns {{ roads_analyzed: number, scores: object[] }}
 */
export async function computeRiskScores(supabaseAdmin, { roadIds = null } = {}) {
  // 1. Roads in scope
  let roadQuery = supabaseAdmin
    .from('road_segments')
    .select('id, district_id, name, current_status')
  if (roadIds?.length) roadQuery = roadQuery.in('id', roadIds)

  const { data: roads, error: roadsError } = await roadQuery
  if (roadsError) throw new Error(`Risk engine: road fetch failed - ${roadsError.message}`)
  if (!roads || roads.length === 0) return { roads_analyzed: 0, scores: [] }

  const ids = roads.map(r => r.id)
  const districtIds = [...new Set(roads.map(r => r.district_id).filter(Boolean))]

  // 2. Latest recent weather per district (ordered so the first hit per district is newest)
  const { data: weatherRows, error: weatherError } = await supabaseAdmin
    .from('weather_snapshots')
    .select('id, district_id, rainfall_24h_mm, flood_risk_indicator, landslide_risk_indicator, fetched_at')
    .in('district_id', districtIds)
    .gte('fetched_at', new Date(Date.now() - WEATHER_MAX_AGE_MS).toISOString())
    .order('fetched_at', { ascending: false })
  if (weatherError) throw new Error(`Risk engine: weather fetch failed - ${weatherError.message}`)

  const weatherByDistrict = {}
  for (const w of weatherRows ?? []) {
    if (!weatherByDistrict[w.district_id]) weatherByDistrict[w.district_id] = w
  }

  // 3. Active incidents on these roads
  const { data: incidentRows, error: incidentsError } = await supabaseAdmin
    .from('incident_reports')
    .select('road_segment_id, severity')
    .in('road_segment_id', ids)
    .in('status', ['pending', 'verified'])
  if (incidentsError) throw new Error(`Risk engine: incident fetch failed - ${incidentsError.message}`)

  const incidentsByRoad = {}
  for (const inc of incidentRows ?? []) {
    ;(incidentsByRoad[inc.road_segment_id] ||= []).push(inc)
  }

  // 4. Score each road with a full explainability record
  const now = Date.now()
  const scores = roads.map(road => {
    const weather = weatherByDistrict[road.district_id]
    const incidents = incidentsByRoad[road.id] ?? []
    const factors = {}
    let score = BASELINE_RISK

    if (weather) {
      const weatherRisk = Math.max(weather.flood_risk_indicator ?? 0, weather.landslide_risk_indicator ?? 0)
      const contribution = weatherRisk * WEIGHTS.weather
      score += contribution
      factors.weather = {
        raw_rainfall_24h: weather.rainfall_24h_mm,
        flood_risk_base: weather.flood_risk_indicator,
        landslide_risk_base: weather.landslide_risk_indicator,
        weight: WEIGHTS.weather,
        contribution: +contribution.toFixed(3),
      }
    } else {
      factors.weather = { missing: true, weight: WEIGHTS.weather, contribution: 0 }
    }

    const incidentContribution = incidentRiskFor(incidents) * WEIGHTS.incidents
    score += incidentContribution
    factors.incidents = {
      active_count: incidents.length,
      max_severity: incidents.map(i => i.severity)[0] ?? null,
      weight: WEIGHTS.incidents,
      contribution: +incidentContribution.toFixed(3),
    }

    const infraContribution = (INFRA_RISK_BY_STATUS[road.current_status] ?? 0) * WEIGHTS.infrastructure
    score += infraContribution
    factors.infrastructure = {
      current_status: road.current_status,
      weight: WEIGHTS.infrastructure,
      contribution: +infraContribution.toFixed(3),
    }

    factors.engine = 'rule_engine_v1'

    return {
      road_segment_id: road.id,
      score: +Math.min(score, 1).toFixed(3),
      factors_json: factors,
      weather_snapshot_id: weather?.id ?? null,
      computed_at: new Date(now).toISOString(),
      valid_until: new Date(now + SCORE_TTL_MS).toISOString(),
    }
  })

  // 5. Replace previous scores for these roads
  const { error: deleteError } = await supabaseAdmin.from('risk_scores').delete().in('road_segment_id', ids)
  if (deleteError) throw new Error(`Risk engine: clear old scores failed - ${deleteError.message}`)

  const { error: insertError } = await supabaseAdmin.from('risk_scores').insert(scores)
  if (insertError) throw new Error(`Risk engine: insert scores failed - ${insertError.message}`)

  return { roads_analyzed: roads.length, scores }
}