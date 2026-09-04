import { createAdminSupabaseClient } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'

// OpenStreetMap Overpass API query for NER road network
// This query fetches major roads (national highways, state highways) 
// in the 8 northeastern states of India
const NER_OVERPASS_QUERY = `
[out:json][timeout:25];
(
  // National Highways in NER states
  way["highway"="trunk"]["ref"~"NH-"][
    "place"~"Assam|Meghalaya|Tripura|Mizoram|Manipur|Nagaland|Arunachal Pradesh|Sikkim"
  ];
  // State highways  
  way["highway"="primary"]["ref"~"SH-"][
    "place"~"Assam|Meghalaya|Tripura|Mizoram|Manipur|Nagaland|Arunachal Pradesh|Sikkim"
  ];
  // Major district roads
  way["highway"="secondary"][
    "place"~"Assam|Meghalaya|Tripura|Mizoram|Manipur|Nagaland|Arunachal Pradesh|Sikkim"
  ];
);
out geom;
`

export async function POST(request) {
  try {
    const supabase = createAdminSupabaseClient()

    // Step 1: Create seed districts for NER
    console.log('Creating NER districts...')
    
    const districts = [
      { name: 'Guwahati', state: 'Assam', headquarters: 'Guwahati', area_sq_km: 264 },
      { name: 'Kamrup', state: 'Assam', headquarters: 'Guwahati', area_sq_km: 4345 },
      { name: 'East Khasi Hills', state: 'Meghalaya', headquarters: 'Shillong', area_sq_km: 2752 },
      { name: 'West Garo Hills', state: 'Meghalaya', headquarters: 'Tura', area_sq_km: 3714 },
      { name: 'Imphal West', state: 'Manipur', headquarters: 'Imphal', area_sq_km: 519 },
      { name: 'Imphal East', state: 'Manipur', headquarters: 'Porompat', area_sq_km: 709 },
      { name: 'West Tripura', state: 'Tripura', headquarters: 'Agartala', area_sq_km: 983 },
      { name: 'Aizawl', state: 'Mizoram', headquarters: 'Aizawl', area_sq_km: 3576 },
      { name: 'Dimapur', state: 'Nagaland', headquarters: 'Dimapur', area_sq_km: 927 },
      { name: 'West Kameng', state: 'Arunachal Pradesh', headquarters: 'Bomdila', area_sq_km: 7422 },
      { name: 'East Sikkim', state: 'Sikkim', headquarters: 'Gangtok', area_sq_km: 954 },
    ]

    const { data: insertedDistricts, error: districtError } = await supabase
      .from('districts')
      .insert(districts)
      .select()

    if (districtError) {
      console.error('District insert error:', districtError)
      return NextResponse.json({ error: 'Failed to create districts' }, { status: 500 })
    }

    console.log(`✅ Created ${insertedDistricts.length} districts`)

    // Step 2: Fetch road data from OpenStreetMap
    console.log('Fetching road network from OpenStreetMap...')
    
    const overpassUrl = 'https://overpass-api.de/api/interpreter'
    const response = await fetch(overpassUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: NER_OVERPASS_QUERY
    })

    if (!response.ok) {
      throw new Error(`OpenStreetMap API error: ${response.status}`)
    }

    const osmData = await response.json()
    console.log(`📍 Fetched ${osmData.elements.length} road segments from OSM`)

    // Step 3: Process and insert road segments
    const roadSegments = []
    
    for (const way of osmData.elements) {
      if (!way.geometry || way.geometry.length < 2) continue

      // Determine district assignment based on road coordinates
      // This is simplified - in production you'd use spatial intersection
      const avgLat = way.geometry.reduce((sum, coord) => sum + coord.lat, 0) / way.geometry.length
      const avgLng = way.geometry.reduce((sum, coord) => sum + coord.lng, 0) / way.geometry.length
      
      // Simple coordinate-based district assignment for demo
      let assignedDistrict = insertedDistricts[0] // Default to Guwahati
      if (avgLat > 26.0 && avgLng < 92.0) assignedDistrict = insertedDistricts.find(d => d.name === 'East Khasi Hills') || assignedDistrict
      if (avgLat > 25.5 && avgLng > 93.5) assignedDistrict = insertedDistricts.find(d => d.name === 'Imphal West') || assignedDistrict

      // Convert coordinates to PostGIS LINESTRING format
      const coordinateString = way.geometry
        .map(coord => `${coord.lng} ${coord.lat}`)
        .join(', ')
      
      const linestring = `LINESTRING(${coordinateString})`

      // Calculate rough length in km
      const length = calculateRoughDistance(way.geometry)

      roadSegments.push({
        district_id: assignedDistrict.id,
        name: way.tags?.name || way.tags?.ref || `Unnamed Road ${way.id}`,
        road_type: way.tags?.highway === 'trunk' ? 'national_highway' 
                 : way.tags?.highway === 'primary' ? 'state_highway'
                 : 'district_road',
        geometry: linestring,
        length_km: length,
        surface_type: way.tags?.surface || 'paved',
        current_status: 'open',
        osm_id: way.id?.toString()
      })
    }

    // Insert in batches to avoid overwhelming the database
    const batchSize = 50
    let totalInserted = 0

    for (let i = 0; i < roadSegments.length; i += batchSize) {
      const batch = roadSegments.slice(i, i + batchSize)
      
      const { data: batchResult, error: batchError } = await supabase
        .from('road_segments')
        .insert(batch)
        .select('id')

      if (batchError) {
        console.error('Batch insert error:', batchError)
        continue
      }

      totalInserted += batchResult.length
      console.log(`📊 Inserted batch ${Math.floor(i/batchSize) + 1}: ${batchResult.length} segments`)
    }

    return NextResponse.json({
      success: true,
      districts_created: insertedDistricts.length,
      road_segments_created: totalInserted,
      message: `Successfully ingested ${totalInserted} road segments across ${insertedDistricts.length} districts`
    })

  } catch (error) {
    console.error('Road ingestion error:', error)
    return NextResponse.json(
      { error: 'Failed to ingest road data', details: error.message },
      { status: 500 }
    )
  }
}

// Helper function to calculate approximate road length
function calculateRoughDistance(coordinates) {
  if (coordinates.length < 2) return 0
  
  let totalDistance = 0
  for (let i = 1; i < coordinates.length; i++) {
    const lat1 = coordinates[i-1].lat
    const lng1 = coordinates[i-1].lng
    const lat2 = coordinates[i].lat
    const lng2 = coordinates[i].lng
    
    // Haversine formula for approximate distance
    const R = 6371 // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    const distance = R * c
    
    totalDistance += distance
  }
  
  return Math.round(totalDistance * 100) / 100 // Round to 2 decimal places
}