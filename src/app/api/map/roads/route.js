import { createServerSupabaseClient } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()

    const { data, error } = await supabase
      .from('map_road_segments')
      .select('*')

    if (error) {
      throw new Error(error.message)
    }

    // Transform into GeoJSON FeatureCollection - the standard format
    // that mapping libraries expect for rendering multiple features
    const geojson = {
      type: 'FeatureCollection',
      features: data.map(road => ({
        type: 'Feature',
        geometry: road.geometry_geojson,
        properties: {
          id: road.id,
          name: road.name,
          road_type: road.road_type,
          surface_type: road.surface_type,
          current_status: road.current_status,
          length_km: road.length_km,
          district_name: road.district_name,
          district_state: road.district_state,
          risk_score: road.risk_score,
          risk_level: road.risk_level,
          factors_json: road.factors_json,
          risk_computed_at: road.risk_computed_at
        }
      }))
    }

    return NextResponse.json({
      success: true,
      count: data.length,
      geojson
    })

  } catch (error) {
    console.error('Map data fetch error:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}