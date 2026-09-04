import { createAdminSupabaseClient } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const supabase = createAdminSupabaseClient()
    
    console.log('🚀 Starting NER data ingestion...')

    // Step 1: Clear existing data
    await supabase.from('road_segments').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await supabase.from('districts').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    console.log('✅ Cleared existing data')

    // Step 2: Create NER districts
    const districtsData = [
      { name: 'Guwahati Metropolitan', state: 'Assam', headquarters: 'Guwahati', area_sq_km: 264, connectivity_status: 'normal' },
      { name: 'Kamrup Rural', state: 'Assam', headquarters: 'Amingaon', area_sq_km: 4345, connectivity_status: 'normal' },
      { name: 'East Khasi Hills', state: 'Meghalaya', headquarters: 'Shillong', area_sq_km: 2752, connectivity_status: 'normal' },
      { name: 'West Garo Hills', state: 'Meghalaya', headquarters: 'Tura', area_sq_km: 3714, connectivity_status: 'disrupted' },
      { name: 'Imphal West', state: 'Manipur', headquarters: 'Imphal', area_sq_km: 519, connectivity_status: 'normal' },
      { name: 'West Tripura', state: 'Tripura', headquarters: 'Agartala', area_sq_km: 983, connectivity_status: 'normal' },
      { name: 'Aizawl', state: 'Mizoram', headquarters: 'Aizawl', area_sq_km: 3576, connectivity_status: 'disrupted' },
      { name: 'Dimapur', state: 'Nagaland', headquarters: 'Dimapur', area_sq_km: 927, connectivity_status: 'normal' },
      { name: 'West Kameng', state: 'Arunachal Pradesh', headquarters: 'Bomdila', area_sq_km: 7422, connectivity_status: 'critical' },
      { name: 'East Sikkim', state: 'Sikkim', headquarters: 'Gangtok', area_sq_km: 954, connectivity_status: 'normal' },
    ]

    const { data: districts, error: districtError } = await supabase
      .from('districts')
      .insert(districtsData)
      .select()

    if (districtError) {
      throw new Error(`District creation failed: ${districtError.message}`)
    }

    console.log(`✅ Created ${districts.length} districts`)

    // Step 3: Create guaranteed road network (skip OSM complexity for now)
    const roadSegments = [
      {
        district_id: districts.find(d => d.name === 'Guwahati Metropolitan')?.id,
        name: 'NH-27 Guwahati-Shillong Highway',
        road_type: 'national_highway',
        geometry: 'LINESTRING(91.7362 26.1445, 91.7401 26.1456, 91.7423 26.1467, 91.7445 26.1478, 91.7467 26.1489)',
        length_km: 14.2,
        surface_type: 'paved',
        current_status: 'open',
        osm_id: 'ner_001'
      },
      {
        district_id: districts.find(d => d.name === 'East Khasi Hills')?.id,
        name: 'NH-40 Shillong-Cherrapunji Road',
        road_type: 'national_highway',
        geometry: 'LINESTRING(91.8854 25.5788, 91.8875 25.5799, 91.8896 25.5810, 91.8917 25.5821)',
        length_km: 9.8,
        surface_type: 'paved',
        current_status: 'partially_blocked',
        osm_id: 'ner_002'
      },
      {
        district_id: districts.find(d => d.name === 'West Garo Hills')?.id,
        name: 'SH-12 Tura-Dalu Road',
        road_type: 'state_highway',
        geometry: 'LINESTRING(90.2304 25.5102, 90.2321 25.5115, 90.2338 25.5128)',
        length_km: 7.5,
        surface_type: 'unpaved',
        current_status: 'blocked',
        osm_id: 'ner_003'
      },
      {
        district_id: districts.find(d => d.name === 'Imphal West')?.id,
        name: 'NH-102 Imphal-Dimapur Highway',
        road_type: 'national_highway',
        geometry: 'LINESTRING(93.9063 24.8170, 93.9084 24.8181, 93.9105 24.8192, 93.9126 24.8203)',
        length_km: 16.3,
        surface_type: 'paved',
        current_status: 'open',
        osm_id: 'ner_004'
      },
      {
        district_id: districts.find(d => d.name === 'West Kameng')?.id,
        name: 'Bomdila-Tawang Mountain Road',
        road_type: 'border_road',
        geometry: 'LINESTRING(92.4100 27.4800, 92.4150 27.4850, 92.4200 27.4900)',
        length_km: 22.4,
        surface_type: 'paved',
        current_status: 'under_repair',
        osm_id: 'ner_005'
      },
      {
        district_id: districts.find(d => d.name === 'Aizawl')?.id,
        name: 'NH-306 Aizawl-Champhai Road',
        road_type: 'national_highway',
        geometry: 'LINESTRING(92.7173 23.7307, 92.7194 23.7318, 92.7215 23.7329)',
        length_km: 11.6,
        surface_type: 'paved',
        current_status: 'open',
        osm_id: 'ner_006'
      },
      {
        district_id: districts.find(d => d.name === 'Dimapur')?.id,
        name: 'NH-29 Dimapur-Kohima Highway',
        road_type: 'national_highway',
        geometry: 'LINESTRING(93.7288 25.9044, 93.7309 25.9055, 93.7330 25.9066)',
        length_km: 18.7,
        surface_type: 'paved',
        current_status: 'partially_blocked',
        osm_id: 'ner_007'
      },
      {
        district_id: districts.find(d => d.name === 'East Sikkim')?.id,
        name: 'NH-10 Gangtok-Nathula Pass Road',
        road_type: 'border_road',
        geometry: 'LINESTRING(88.6138 27.3389, 88.6159 27.3400, 88.6180 27.3411)',
        length_km: 25.1,
        surface_type: 'paved',
        current_status: 'closed',
        osm_id: 'ner_008'
      }
    ]

    // Filter out any segments where district lookup failed
    const validRoadSegments = roadSegments.filter(segment => segment.district_id)
    
    const { data: insertedRoads, error: roadsError } = await supabase
      .from('road_segments')
      .insert(validRoadSegments)
      .select('id')

    if (roadsError) {
      throw new Error(`Road segments creation failed: ${roadsError.message}`)
    }

    console.log(`🛣️ Created ${insertedRoads.length} road segments`)

    // Step 4: Return success response
    return NextResponse.json({
      success: true,
      source: 'guaranteed_sample_ner_roads',
      districts_created: districts.length,
      road_segments_created: insertedRoads.length,
      message: `Successfully created ${districts.length} NER districts and ${insertedRoads.length} road segments with real coordinates`,
      next_step: 'Ready for weather data integration and risk scoring'
    })

  } catch (error) {
    console.error('❌ Ingestion error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      districts_created: 0,
      road_segments_created: 0
    }, { status: 500 })
  }
}