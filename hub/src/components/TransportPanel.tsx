import { useCallback } from 'react'
import { api, type TransportData } from '../lib/api'
import { usePolling } from '../hooks/usePolling'

interface Departure {
  line: string
  destination: string
  departureTime: string
  aimedTime: string
  realtime: boolean
  delayed: boolean
  delayMinutes: number
  cancelled: boolean
  transportMode: string
}

function formatMinutes(departureTime: string): number {
  return Math.max(0, Math.round((new Date(departureTime).getTime() - Date.now()) / 60000))
}

function formatMinutesLabel(departureTime: string): string {
  const diff = formatMinutes(departureTime)
  if (diff <= 0) return 'Nå'
  if (diff === 1) return '1 min'
  return `${diff} min`
}

function formatAimedTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
}

/** Oslo T-bane line colors based on actual Ruter colors */
function getLineBadgeStyle(line: string, mode: string): { bg: string; text: string } {
  if (mode === 'metro') {
    const metroColors: Record<string, string> = {
      '1': '#0352A0',
      '2': '#F26522',
      '3': '#F26522',
      '4': '#0352A0',
      '5': '#00A857',
      '6': '#0352A0',
    }
    const bg = metroColors[line] ?? '#818CF8'
    return { bg, text: '#ffffff' }
  }
  if (mode === 'bus') {
    return { bg: '#E60000', text: '#ffffff' }
  }
  if (mode === 'tram') {
    return { bg: '#0352A0', text: '#ffffff' }
  }
  return { bg: '#818CF8', text: '#ffffff' }
}

function MetroDepartureRow({ dep, isFirst }: { dep: Departure; isFirst: boolean }) {
  const style = getLineBadgeStyle(dep.line, dep.transportMode)
  const mins = formatMinutesLabel(dep.departureTime)
  const isNow = mins === 'Nå'
  const minsNum = formatMinutes(dep.departureTime)

  return (
    <div
      className={`flex items-center gap-3 py-2.5 px-3.5 rounded-[14px] transition-colors ${
        dep.cancelled ? 'opacity-30' : ''
      } ${isFirst ? 'bg-hub-surface/80 border border-white/[0.04]' : ''}`}
    >
      {/* Line badge */}
      <span
        className="text-[12px] font-bold px-2 py-0.5 rounded-[6px] min-w-[32px] text-center leading-tight"
        style={{ backgroundColor: style.bg, color: style.text }}
      >
        {dep.line}
      </span>

      {/* Destination */}
      <span className={`text-[14px] flex-1 truncate ${dep.cancelled ? 'line-through text-hub-muted' : 'text-hub-text font-medium'}`}>
        {dep.destination}
      </span>

      {/* Delay indicator */}
      {dep.delayed && !dep.cancelled && (
        <span className="text-[11px] text-hub-muted line-through tabular-nums">
          {formatAimedTime(dep.aimedTime)}
        </span>
      )}

      {/* Time — big for first, medium for second */}
      <span
        className={`font-bold tabular-nums ${
          isFirst ? 'text-[28px]' : 'text-[18px]'
        } ${
          dep.cancelled
            ? 'line-through text-hub-muted'
            : dep.delayed
              ? 'text-hub-yellow'
              : isNow
                ? 'text-hub-green'
                : 'text-hub-text'
        }`}
      >
        {dep.cancelled ? 'Innstilt' : isFirst && !isNow ? `${minsNum}` : mins}
      </span>

      {isFirst && !isNow && !dep.cancelled && (
        <span className="text-[13px] text-hub-muted font-semibold -ml-1">min</span>
      )}

      {/* Realtime dot */}
      {dep.realtime && !dep.cancelled && (
        <span
          className="w-[6px] h-[6px] rounded-full bg-hub-green pulse-dot flex-shrink-0"
          title="Sanntid"
        />
      )}
    </div>
  )
}

function BusDepartureRow({ dep }: { dep: Departure }) {
  const style = getLineBadgeStyle(dep.line, dep.transportMode)
  const mins = formatMinutesLabel(dep.departureTime)
  const isNow = mins === 'Nå'

  return (
    <div
      className={`flex items-center gap-3 py-1.5 px-3.5 ${dep.cancelled ? 'opacity-30' : ''}`}
    >
      {/* Line badge */}
      <span
        className="text-[11px] font-bold px-1.5 py-0.5 rounded-[5px] min-w-[32px] text-center leading-tight"
        style={{ backgroundColor: style.bg, color: style.text }}
      >
        {dep.line}
      </span>

      {/* Destination */}
      <span className={`text-[13px] flex-1 truncate ${dep.cancelled ? 'line-through text-hub-muted' : 'text-hub-muted'}`}>
        {dep.destination}
      </span>

      {/* Time */}
      <span
        className={`text-[15px] font-semibold tabular-nums ${
          dep.cancelled
            ? 'line-through text-hub-muted'
            : dep.delayed
              ? 'text-hub-yellow'
              : isNow
                ? 'text-hub-green'
                : 'text-hub-muted'
        }`}
      >
        {dep.cancelled ? 'Innstilt' : mins}
      </span>

      {dep.realtime && !dep.cancelled && (
        <span
          className="w-[5px] h-[5px] rounded-full bg-hub-green pulse-dot flex-shrink-0"
          title="Sanntid"
        />
      )}
    </div>
  )
}

export function TransportPanel() {
  const fetcher = useCallback(() => api.transport(), [])
  const { data, loading } = usePolling<TransportData>(fetcher, 30 * 1000)

  if (loading || !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-hub-accent animate-spin" />
          <span className="text-xs text-hub-muted">Laster avganger...</span>
        </div>
      </div>
    )
  }

  // T-bane first (always show next 2), then fill with bus
  const active = [...data.departures]
    .filter((d) => !d.cancelled)
    .sort((a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime())

  const metro = active.filter((d) => d.transportMode === 'metro').slice(0, 2)
  const bus = active.filter((d) => d.transportMode !== 'metro').slice(0, 2)

  return (
    <div className="h-full flex flex-col p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="label">Ut dora</div>
        <span className="text-[11px] text-hub-muted/40">fra {data.stopName}</span>
      </div>

      {/* Metro departures */}
      {metro.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] text-hub-muted/50 uppercase tracking-[0.1em] font-semibold mb-1.5 px-1">T-bane</div>
          <div className="flex flex-col gap-1">
            {metro.map((dep, i) => (
              <MetroDepartureRow
                key={`${dep.line}-${dep.departureTime}-${i}`}
                dep={dep}
                isFirst={i === 0}
              />
            ))}
          </div>
        </div>
      )}

      {/* Bus departures */}
      {bus.length > 0 && (
        <div>
          <div className="text-[11px] text-hub-muted/50 uppercase tracking-[0.1em] font-semibold mb-1.5 px-1">Buss</div>
          <div className="flex flex-col gap-0.5">
            {bus.map((dep, i) => (
              <BusDepartureRow
                key={`${dep.line}-${dep.departureTime}-${i}`}
                dep={dep}
              />
            ))}
          </div>
        </div>
      )}

      {metro.length === 0 && bus.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-[14px] text-hub-muted/50">Ingen avganger</span>
        </div>
      )}
    </div>
  )
}
