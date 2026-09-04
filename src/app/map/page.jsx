import AccessibilityMap from '@/components/AccessibilityMap'

export const metadata = {
  title: 'NER Accessibility Map | SETU-NER',
}

export default function MapPage() {
  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <h1 className="text-xl font-bold text-white">
          SETU-NER: Real-Time Accessibility Dashboard
        </h1>
        <p className="text-sm text-gray-400">
          Live road network status across North Eastern Region
        </p>
      </header>

      <div className="flex-1 relative">
        <AccessibilityMap />
      </div>

      <footer className="bg-gray-900 border-t border-gray-800 px-6 py-3 flex gap-6 text-xs text-gray-400">
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-green-500 inline-block"></span>
          Low Risk / Open
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-yellow-500 inline-block"></span>
          Moderate Risk
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-orange-500 inline-block"></span>
          High Risk / Partially Blocked
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500 inline-block"></span>
          Critical / Blocked
        </span>
      </footer>
    </div>
  )
}