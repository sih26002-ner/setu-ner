import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabaseServer'
import { computeRiskScores } from '@/lib/riskEngine'

// ---------- 1. Request contract (single source of truth for what we accept) ----------
const IncidentSchema = z.object({
  incident_type: z.enum([
    'landslide', 'flood', 'road_damage', 'bridge_damage',
    'traffic_blockage', 'fallen_tree', 'other',
  ]),
  severity: z.enum(['low', 'moderate', 'high', 'critical']).default('moderate'),
  description: z.string().trim().max(2000).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy_meters: z.number().nonnegative().optional(),
  // Set by the client when the report was created offline; enables idempotent retries
  offline_id: z.string().uuid().optional(),
  // When the report was actually captured (offline may lag submission by hours)
  reported_at: z.string().datetime().optional(),
})

// Two radii, two purposes:
//  - MAX_SNAP_DISTANCE_M:   link the report to a specific road only if this close
//  - JURISDICTION_RADIUS_M: the nearest mapped road within this range is used ONLY
//                           to infer which district the point lies in.
// Phase 2: replace the jurisdiction heuristic with ST_Contains against district polygons.
const MAX_SNAP_DISTANCE_M = 5000
const JURISDICTION_RADIUS_M = 50000

// ---------- 2. Consistent error shape ----------
function fail(status, code, message, extra = {}) {
  return NextResponse.json({ success: false, error: code, message, ...extra }, { status })
}

export async function POST(request) {
  // ---- Parse body (invalid JSON is a client error, not a server crash) ----
  let body
  try {
    body = await request.json()
  } catch {
    return fail(400, 'INVALID_JSON', 'Request body must be valid JSON')
  }

  // ---- Validate ----
  const parsed = IncidentSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, 'VALIDATION_ERROR', 'Invalid incident payload', {
      issues: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
    })
  }
  const input = parsed.data

  try {
    const supabase = await createServerSupabaseClient()   // user session, RLS enforced
    const supabaseAdmin = createAdminSupabaseClient()     // audit + re-score only

    // ---- Identity: never trust the client for who is reporting ----
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return fail(401, 'UNAUTHENTICATED', 'Login required')

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('role, district_id, full_name')
      .eq('id', user.id)
      .single()
    if (profileError || !profile) return fail(403, 'NO_PROFILE', 'User profile not found')

    if (profile.role !== 'field_officer') {
      return fail(403, 'FORBIDDEN_ROLE', 'Only field officers can file incident reports')
    }
    if (!profile.district_id) {
      return fail(403, 'NO_DISTRICT', 'Your account has no district assignment. Contact your administrator.')
    }

    // ---- Idempotency: a retried offline submission must not create a duplicate ----
    if (input.offline_id) {
      const { data: existing } = await supabase
        .from('incident_reports')
        .select('id, status, created_at')
        .eq('offline_id', input.offline_id)
        .maybeSingle()
      if (existing) {
        return NextResponse.json(
          { success: true, duplicate: true, incident: existing, message: 'Report already recorded' },
          { status: 200 },
        )
      }
    }

    // ---- Geospatial: one query at the wide radius; derive both facts from it ----
    const { data: nearest, error: nearestError } = await supabase.rpc('find_nearest_road_segment', {
      p_lat: input.latitude,
      p_lng: input.longitude,
      p_max_distance_m: JURISDICTION_RADIUS_M,
    })
    if (nearestError) throw new Error(`Nearest-road lookup failed: ${nearestError.message}`)

    const nearestAny = nearest?.[0] ?? null                                   // for jurisdiction
    const road = nearestAny && nearestAny.distance_m <= MAX_SNAP_DISTANCE_M   // for linkage
      ? nearestAny
      : null

    // ---- Jurisdiction: decided from the nearest mapped road, even if too far to snap ----
    if (!nearestAny) {
      return fail(422, 'LOCATION_UNRESOLVED',
        'No mapped road network within 50 km of this point. Check the pin position.',
      )
    }
    if (nearestAny.district_id !== profile.district_id) {
      return fail(403, 'OUTSIDE_JURISDICTION',
        `This location is closest to ${nearestAny.road_name} in ${nearestAny.district_name} ` +
        `(~${(nearestAny.distance_m / 1000).toFixed(1)} km away), outside your assigned district.`,
        { nearest_road: nearestAny },
      )
    }

    // ---- Insert (through the user client so RLS is the final gate) ----
    const insertPayload = {
      incident_type: input.incident_type,
      severity: input.severity,
      description: input.description ?? null,
      // EWKT with explicit SRID. Longitude FIRST - PostGIS is (x, y).
      geometry: `SRID=4326;POINT(${input.longitude} ${input.latitude})`,
      road_segment_id: road?.road_segment_id ?? null,
      district_id: nearestAny.district_id,
      location_address: road
        ? `Near ${road.road_name}, ${road.district_name} (~${Math.round(road.distance_m)} m from road)`
        : `Unmapped location in ${nearestAny.district_name} (~${(nearestAny.distance_m / 1000).toFixed(1)} km from ${nearestAny.road_name}) - pending admin review`,
      reported_by: user.id,
      status: 'pending',
      offline_id: input.offline_id ?? null,
      ...(input.reported_at ? { created_at: input.reported_at } : {}),
    }

    const { data: incident, error: insertError } = await supabase
      .from('incident_reports')
      .insert(insertPayload)
      .select('id, incident_type, severity, status, district_id, road_segment_id, location_address, created_at')
      .single()

    if (insertError) {
      // RLS rejections surface here as 42501 - report as forbidden, not as a server fault
      if (insertError.code === '42501') {
        return fail(403, 'RLS_DENIED', 'Database policy rejected this report')
      }
      throw new Error(`Insert failed: ${insertError.message}`)
    }

    // ---- Audit trail (service role - the only role permitted to write audit_logs) ----
    const { error: auditError } = await supabaseAdmin.from('audit_logs').insert({
      user_id: user.id,
      action: 'incident_report.created',
      table_name: 'incident_reports',
      record_id: incident.id,
      new_values: {
        ...insertPayload,
        accuracy_meters: input.accuracy_meters ?? null,
        snapped_distance_m: road?.distance_m ?? null,
        jurisdiction_inferred_from: {
          road_segment_id: nearestAny.road_segment_id,
          road_name: nearestAny.road_name,
          distance_m: nearestAny.distance_m,
        },
      },
      ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      user_agent: request.headers.get('user-agent') ?? null,
    })
    if (auditError) console.error('⚠️ Audit log write failed:', auditError.message)

    // ---- Intelligence loop: re-score the affected road immediately ----
    let updatedRisk = null
    if (incident.road_segment_id) {
      try {
        const { scores } = await computeRiskScores(supabaseAdmin, { roadIds: [incident.road_segment_id] })
        updatedRisk = scores[0] ?? null
      } catch (riskError) {
        // The report is saved; a scoring hiccup must not fail the officer's submission
        console.error('⚠️ Post-incident re-score failed:', riskError.message)
      }
    }

    return NextResponse.json(
      {
        success: true,
        incident,
        nearest_road: road,
        updated_risk: updatedRisk
          ? { score: updatedRisk.score, factors: updatedRisk.factors_json }
          : null,
        message: road
          ? `Incident recorded on ${road.road_name}. Road risk recalculated.`
          : `Incident recorded in ${nearestAny.district_name}. No mapped road within 5 km - an administrator will review the location.`,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error('❌ /api/incidents POST error:', error)
    // Never leak stack traces or SQL to the client
    return fail(500, 'INTERNAL_ERROR', 'Could not record the incident. Please retry.')
  }
}