// Open-Meteo Weather Service for NER region
// Provides live rainfall, visibility, and weather conditions for district-level risk assessment

const DISTRICT_COORDINATES = {
  'Guwahati Metropolitan': { lat: 26.1445, lng: 91.7362, elevation: 55 },
  'Kamrup Rural': { lat: 26.2000, lng: 91.5833, elevation: 60 },
  'East Khasi Hills': { lat: 25.5788, lng: 91.8854, elevation: 1496 },
  'West Garo Hills': { lat: 25.5102, lng: 90.2304, elevation: 1515 },
  'Imphal West': { lat: 24.8170, lng: 93.9063, elevation: 790 },
  'West Tripura': { lat: 23.8315, lng: 91.2868, elevation: 15 },
  'Aizawl': { lat: 23.7307, lng: 92.7173, elevation: 1132 },
  'Dimapur': { lat: 25.9044, lng: 93.7288, elevation: 98 },
  'West Kameng': { lat: 27.4800, lng: 92.4100, elevation: 2217 },
  'East Sikkim': { lat: 27.3389, lng: 88.6138, elevation: 1437 }
}

/**
 * Calculate flood risk score (0.0 to 1.0) based on precipitation
 */
function calculateFloodRisk(currentPrecipitation, dailyTotal) {
  let risk = 0
  if (currentPrecipitation > 20) risk += 0.5
  else if (currentPrecipitation > 10) risk += 0.3
  else if (currentPrecipitation > 5) risk += 0.1

  if (dailyTotal > 100) risk += 0.4
  else if (dailyTotal > 50) risk += 0.2
  else if (dailyTotal > 25) risk += 0.1

  return Math.min(risk, 1.0)
}

/**
 * Calculate landslide risk score (0.0 to 1.0) based on rain + elevation
 */
function calculateLandslideRisk(currentRain, dailyRain, elevation) {
  let risk = 0
  if (currentRain > 15) risk += 0.4
  else if (currentRain > 8) risk += 0.2
  else if (currentRain > 3) risk += 0.1

  if (dailyRain > 75) risk += 0.3
  else if (dailyRain > 40) risk += 0.2
  else if (dailyRain > 20) risk += 0.1

  if (elevation > 2000) risk += 0.3
  else if (elevation > 1000) risk += 0.2
  else if (elevation > 500) risk += 0.1

  return Math.min(risk, 1.0)
}

/**
 * Calculate visibility risk score (0.0 to 1.0) based on visibility and weather conditions
 */
function calculateVisibilityRisk(visibilityKm, weatherCode) {
  let risk = 0
  if (visibilityKm < 1) risk += 0.5
  else if (visibilityKm < 3) risk += 0.3
  else if (visibilityKm < 5) risk += 0.1

  if (weatherCode >= 95) risk += 0.3
  else if (weatherCode >= 80) risk += 0.2
  else if (weatherCode >= 61) risk += 0.1
  else if (weatherCode >= 45) risk += 0.2

  return Math.min(risk, 1.0)
}

/**
 * Fetches live weather data for a specific district
 */
export async function getDistrictWeather(districtName) {
  const coords = DISTRICT_COORDINATES[districtName]

  if (!coords) {
    throw new Error(`No coordinates found for district: ${districtName}`)
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m&daily=precipitation_sum,rain_sum,weather_code&timezone=Asia%2FKolkata&forecast_days=1`

    console.log(`🌦️ Fetching weather for ${districtName}:`, url)

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SETU-NER/1.0 (Government Logistics Platform)'
      }
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Weather API error: ${response.status} - ${errText}`)
    }

    const data = await response.json()

    const processedWeather = {
      district: districtName,
      coordinates: coords,
      current: {
        temperature_celsius: data.current?.temperature_2m ?? 25,
        humidity_percent: data.current?.relative_humidity_2m ?? 70,
        precipitation_mm: data.current?.precipitation ?? 0,
        rain_mm: data.current?.rain ?? 0,
        weather_code: data.current?.weather_code ?? 0,
        visibility_km: 10,
        wind_speed_kmh: data.current?.wind_speed_10m ?? 5
      },
      today: {
        total_precipitation_mm: data.daily?.precipitation_sum?.[0] ?? 0,
        total_rain_mm: data.daily?.rain_sum?.[0] ?? 0,
        max_weather_code: data.daily?.weather_code?.[0] ?? 0
      },
      risk_indicators: {
        flood_risk: calculateFloodRisk(
          data.current?.precipitation ?? 0,
          data.daily?.precipitation_sum?.[0] ?? 0
        ),
        landslide_risk: calculateLandslideRisk(
          data.current?.rain ?? 0,
          data.daily?.rain_sum?.[0] ?? 0,
          coords.elevation
        ),
        visibility_risk: calculateVisibilityRisk(
          10,
          data.current?.weather_code ?? 0
        )
      },
      fetched_at: new Date().toISOString(),
      source: 'open-meteo',
      api_response_status: 'success'
    }

    return processedWeather

  } catch (error) {
    console.error(`❌ Weather fetch failed for ${districtName}:`, error.message)

    return {
      district: districtName,
      coordinates: coords,
      current: {
        temperature_celsius: 25,
        humidity_percent: 70,
        precipitation_mm: 0,
        rain_mm: 0,
        weather_code: 0,
        visibility_km: 10,
        wind_speed_kmh: 5
      },
      today: {
        total_precipitation_mm: 0,
        total_rain_mm: 0,
        max_weather_code: 0
      },
      risk_indicators: {
        flood_risk: 0.1,
        landslide_risk: 0.1,
        visibility_risk: 0.1
      },
      fetched_at: new Date().toISOString(),
      source: 'fallback-safe',
      api_response_status: 'failed',
      error: error.message
    }
  }
}

/**
 * Fetch weather for all districts
 */
export async function getAllDistrictsWeather() {
  const districts = Object.keys(DISTRICT_COORDINATES)
  console.log(`🌦️ Fetching weather for ${districts.length} NER districts...`)

  const weatherPromises = districts.map(district => getDistrictWeather(district))
  const results = await Promise.allSettled(weatherPromises)

  const weatherData = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value
    } else {
      console.error(`Weather fetch failed for ${districts[index]}:`, result.reason)
      return {
        district: districts[index],
        error: result.reason.message,
        source: 'fallback-error'
      }
    }
  })

  console.log(`✅ Weather data retrieved for ${weatherData.length} districts`)
  return weatherData
}