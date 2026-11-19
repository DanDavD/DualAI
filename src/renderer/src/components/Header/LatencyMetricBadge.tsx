import React from 'react'
import { Activity } from 'lucide-react'
import { useSession } from '../../context/SessionContext'

export const LatencyMetricBadge: React.FC = () => {
  const { latencyPingMs } = useSession()

  // Status color dot based on network quality threshold
  const getStatusColor = (ms: number): string => {
    if (ms < 80) return 'bg-accent-emerald'
    if (ms < 180) return 'bg-accent-amber'
    return 'bg-accent-crimson'
  }

  return (
    <div
      className="flex h-8 items-center space-x-2 rounded border border-surface-border bg-surface-base px-2.5 font-mono text-xs text-text-secondary select-none"
      title="Real-time WebSocket & API Roundtrip Latency (Updated every 5 seconds)"
    >
      <Activity className="h-3 w-3 text-text-muted" strokeWidth={1.5} />
      <span className={`h-1.5 w-1.5 rounded-full ${getStatusColor(latencyPingMs)} animate-pulse`} />
      <span className="text-text-primary font-medium">{latencyPingMs}ms</span>
      <span className="text-[10px] text-text-muted">ping</span>
    </div>
  )
}
