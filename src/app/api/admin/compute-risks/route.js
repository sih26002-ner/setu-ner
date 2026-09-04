import { createAdminSupabaseClient } from '@/lib/supabaseServer'
import { computeRiskScores } from '@/lib/riskEngine'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const supabaseAdmin = createAdminSupabaseClient()
    const result = await computeRiskScores(supabaseAdmin) // all roads

    return NextResponse.json({
      success: true,
      roads_analyzed: result.roads_analyzed,
      scores_generated: result.scores.length,
      sample_score: result.scores[0] ?? null,
      message: 'AI Risk Computation completed successfully',
    })
  } catch (error) {
    console.error('❌ Risk computation error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}