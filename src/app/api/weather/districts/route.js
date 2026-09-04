import { getAllDistrictsWeather } from '@/lib/weatherService'
import { createAdminSupabaseClient } from '@/lib/supabaseServer'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    console.log('🌦️ Weather API route called')

    // Fetch live weather for all NER districts
    const weatherData = await getAllDistrictsWeather()
    
    // Store weather snapshots in database for audit trail and offline access
    const supabase = createAdminSupabaseClient()
    
    // Get district IDs to link weather data
    const { data: districts } = await supabase
      .from('districts')
      .select('id, name')
    
    const weatherSnapshots = []
    
    for (const weather of weatherData) {
      const district = districts?.find(d => d.name === weather.district)
      
      if (district && weather.current) {
        weatherSnapshots.push({
          district_id: district.id,
          rainfall_mm: weather.current.precipitation_mm || 0,
          rainfall_24h_mm: weather.today?.total_precipitation_mm || 0,
          wind_speed_kmh: weather.current.wind_speed_kmh || 0,
          visibility_km: weather.current.visibility_km || 10,
          weather_code: weather.current.weather_code || 0,
          weather_description: getWeatherDescription(weather.current.weather_code || 0),
          temperature_celsius: weather.current.temperature_celsius || 25,
          humidity_percent: weather.current.humidity_percent || 70,
          flood_risk_indicator: weather.risk_indicators?.flood_risk || 0,
          landslide_risk_indicator: weather.risk_indicators?.landslide_risk || 0,
          source: weather.source || 'open-meteo',
          fetched_at: weather.fetched_at,
          valid_until: new Date(Date.now() + 60 * 60 * 1000).toISOString() // Valid for 1 hour
        })
      }
    }
    
    if (weatherSnapshots.length > 0) {
      // Clear old weather data (keep only latest) to prevent database bloat
      await supabase
        .from('weather_snapshots')
        .delete()
        .lt('fetched_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      
      // Insert new weather snapshots
      const { error: insertError } = await supabase
        .from('weather_snapshots')
        .insert(weatherSnapshots)
      
      if (insertError) {
        console.error('❌ Failed to store weather snapshots:', insertError.message)
      } else {
        console.log(`✅ Stored ${weatherSnapshots.length} weather snapshots in database`)
      }
    }
    
    return NextResponse.json({
      success: true,
      districts_count: weatherData.length,
      snapshots_stored: weatherSnapshots.length,
      data: weatherData,
      cached_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      message: 'Live weather data retrieved for all NER districts'
    })

  } catch (error) {
    console.error('❌ Weather API error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      districts_count: 0,
      snapshots_stored: 0
    }, { status: 500 })
  }
}

// Helper function to convert WMO weather codes to descriptions
function getWeatherDescription(code) {
  const descriptions = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow fall',
    73: 'Moderate snow fall',
    75: 'Heavy snow fall',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail'
  }
  return descriptions[code] || 'Unknown conditions'
}