import { createServerSupabaseClient } from '@/lib/supabaseServer'
import IncidentReportForm from '@/components/IncidentReportForm'
import LogoutButton from '@/components/LogoutButton'

export const dynamic = 'force-dynamic' // always fresh - never serve a cached report list

const STATUS_STYLES = {
  pending: 'bg-yellow-900 text-yellow-300',
  verified: 'bg-green-900 text-green-300',
  resolved: 'bg-gray-700 text-gray-300',
  false_report: 'bg-red-900 text-red-300',
}

export default async function FieldOfficerDashboard() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Profile + district via PostgREST embedding (user_profiles.district_id -> districts.id)
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('full_name, department, designation, districts ( name, state )')
    .eq('id', user.id)
    .single()

  // RLS already limits this to reports the officer may see; we further filter to their own
  const { data: reports } = await supabase
    .from('incident_reports')
    .select('id, incident_type, severity, status, location_address, created_at')
    .eq('reported_by', user.id)
    .order('created_at', { ascending: false })
    .limit(10)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="font-semibold">{profile?.full_name ?? 'Field Officer'}</p>
          <p className="text-xs text-gray-400">
            {profile?.designation}, {profile?.department} · {profile?.districts?.name}, {profile?.districts?.state}
          </p>
        </div>
        <LogoutButton />
      </header>

      <main className="max-w-xl mx-auto p-4 space-y-6">
        <IncidentReportForm />

        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">My recent reports</h2>
          {!reports?.length ? (
            <p className="text-sm text-gray-500">No reports yet.</p>
          ) : (
            <ul className="space-y-2">
              {reports.map(r => (
                <li key={r.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">{r.incident_type.replace('_', ' ')} · {r.severity}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[r.status] ?? ''}`}>{r.status}</span>
                  </div>
                  <p className="text-gray-400 text-xs mt-1">{r.location_address}</p>
                  <p className="text-gray-600 text-xs mt-1">{new Date(r.created_at).toLocaleString('en-IN')}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}