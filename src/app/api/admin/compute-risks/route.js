import { createAdminSupabaseClient } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const supabase = createAdminSupabaseClient()
    console.log('🧠 Starting AI Risk Computation Engine...')

    // 1. Get all road segments
    const { data: roads, error: roadsError } = await supabase
      .from('road_segments')
      .select('id, district_id, name, road_type, current_status')
    
    if (roadsError) throw new Error(roadsError.message)

    // 2. Get latest weather snapshot for each district
    const { data: weather, error: weatherError } = await supabase
      .from('weather_snapshots')
      .select('district_id, id, rainfall_mm, rainfall_24h_mm, flood_risk_indicator, landslide_risk_indicator')
      // Only get recent weather
      .gte('fetched_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      
    if (weatherError) throw new Error(weatherError.message)

    // 3. Get recent incidents to factor into the score
    const { data: incidents, error: incidentsError } = await supabase
      .from('incident_reports')
      .select('road_segment_id, severity, status')
      .in('status', ['pending', 'verified'])

    if (incidentsError) throw new Error(incidentsError.message)

    // Map weather by district for O(1) lookup
    const weatherByDistrict = {}
    weather?.forEach(w => { weatherByDistrict[w.district_id] = w })

    // Count incidents per road for O(1) lookup
    const incidentsByRoad = {}
    incidents?.forEach(inc => {
      if (!incidentsByRoad[inc.road_segment_id]) incidentsByRoad[inc.road_segment_id] = []
      incidentsByRoad[inc.road_segment_id].push(inc)
    })

    const riskScores = []

    // 4. THE AI ENGINE: Compute rule-based risk for every road
    for (const road of roads) {
      const localWeather = weatherByDistrict[road.district_id]
      const localIncidents = incidentsByRoad[road.id] || []
      
      let baseScore = 0.1 // Default baseline risk
      const factors = {} // Explainability JSON

      // Factor 1: Weather (Weight: 40%)
      if (localWeather) {
        const weatherRisk = Math.max(localWeather.flood_risk_indicator, localWeather.landslide_risk_indicator)
        const weatherContribution = weatherRisk * 0.4
        baseScore += weatherContribution
        
        factors.weather = {
          raw_rainfall_24h: localWeather.rainfall_24h_mm,
          flood_risk_base: localWeather.flood_risk_indicator,
          landslide_risk_base: localWeather.landslide_risk_indicator,
          contribution: parseFloat(weatherContribution.toFixed(3))
        }
      } else {
        factors.weather = { missing: true, contribution: 0 }
      }

      // Factor 2: Active Incidents (Weight: 40%)
      let incidentRisk = 0
      if (localIncidents.length > 0) {
        const severeCount = localIncidents.filter(i => i.severity === 'critical' || i.severity === 'high').length
        if (severeCount > 0) incidentRisk = 1.0
        else if (localIncidents.length > 1) incidentRisk = 0.6
        else incidentRisk = 0.3
      }
      const incidentContribution = incidentRisk * 0.4
      baseScore += incidentContribution
      factors.incidents = {
        active_count: localIncidents.length,
        contribution: parseFloat(incidentContribution.toFixed(3))
      }

      // Factor 3: Infrastructure Vulnerability based on road status (Weight: 20%)
      let infraRisk = 0
      if (road.current_status === 'closed') infraRisk = 1.0
      else if (road.current_status === 'blocked' || road.current_status === 'partially_blocked') infraRisk = 0.8
      else if (road.current_status === 'under_repair') infraRisk = 0.4
      
      const infraContribution = infraRisk * 0.2
      baseScore += infraContribution
      factors.infrastructure = {
        current_status: road.current_status,
        contribution: parseFloat(infraContribution.toFixed(3))
      }

      // Cap at 1.0
      const finalScore = Math.min(baseScore, 1.0)

      riskScores.push({
        road_segment_id: road.id,
        score: parseFloat(finalScore.toFixed(3)),
        factors_json: factors,
        weather_snapshot_id: localWeather?.id || null,
        computed_at: new Date().toISOString(),
        valid_until: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
      })
    }

    // 5. Save to database
    // First clear old scores for these roads
    const roadIds = roads.map(r => r.id)
    if (roadIds.length > 0) {
      await supabase.from('risk_scores').delete().in('road_segment_id', roadIds)
      
      const { error: insertError } = await supabase.from('risk_scores').insert(riskScores)
      if (insertError) throw new Error(insertError.message)
    }

    return NextResponse.json({
      success: true,
      roads_analyzed: roads.length,
      scores_generated: riskScores.length,
      message: 'AI Risk Computation completed successfully',
      sample_score: riskScores[0] // Return one score to prove it worked
    })

  } catch (error) {
    console.error('❌ Risk computation error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}