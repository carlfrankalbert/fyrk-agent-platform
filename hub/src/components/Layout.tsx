import { useState, useEffect } from 'react'
import { WeatherPanel } from './WeatherPanel'
import { CalendarPanel } from './CalendarPanel'
import { TransportPanel } from './TransportPanel'
import { FoodPanel } from './FoodPanel'

interface Props {
  email: string
  onLogout: () => void
}

function ClockDisplay() {
  const [time, setTime] = useState(() => formatTime(new Date()))

  useEffect(() => {
    const timer = setInterval(() => setTime(formatTime(new Date())), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex flex-col items-center">
      <span className="text-[48px] font-medium tabular-nums text-hub-text tracking-[-0.02em] leading-none">
        {time.hhmm}
      </span>
      <span className="text-[13px] text-hub-muted/70 mt-1 capitalize">
        {time.dateStr}
      </span>
    </div>
  )
}

function formatTime(d: Date) {
  const hhmm = d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
  const dateStr = d.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })
  return { hhmm, dateStr }
}

export function Layout({ email, onLogout }: Props) {
  return (
    <div className="w-screen h-dvh bg-hub-bg flex flex-col">
      {/* Header — renders under status bar in PWA mode */}
      <header className="flex items-center justify-between px-6 flex-shrink-0" style={{ paddingTop: 'max(8px, env(safe-area-inset-top))', height: 'calc(48px + env(safe-area-inset-top, 0px))' }}>
        {/* Left: minimal branding */}
        <div className="flex items-center gap-2 w-[200px]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-hub-muted/30">
            <path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-[10px] font-medium text-hub-muted/30 tracking-wider">HUSMOR HUB</span>
        </div>

        {/* Center: clock */}
        <ClockDisplay />

        {/* Right: email + logout — very quiet */}
        <div className="flex items-center gap-3 w-[200px] justify-end">
          <span className="text-[10px] text-hub-muted/25">{email}</span>
          <button
            onClick={onLogout}
            className="text-hub-muted/25 hover:text-hub-muted/60 transition-colors duration-150 focus-ring rounded p-1"
            title="Logg ut"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </header>

      {/* Dashboard grid */}
      <div className="flex-1 flex flex-col gap-3 px-4 pb-4 pt-2 min-h-0">
        {/* Top row: 3 panels — ~44% of available height */}
        <div className="grid grid-cols-[1fr_1fr_1.3fr] gap-3 h-[44%] flex-shrink-0">
          <div className="bg-hub-card rounded-card shadow-card border border-white/[0.06] overflow-hidden">
            <WeatherPanel />
          </div>
          <div className="bg-hub-card rounded-card shadow-card border border-white/[0.06] overflow-hidden">
            <CalendarPanel />
          </div>
          <div className="bg-hub-card rounded-card shadow-card border border-white/[0.06] overflow-hidden">
            <TransportPanel />
          </div>
        </div>

        {/* Bottom row: meal plan hero */}
        <div className="flex-1 bg-hub-card rounded-card shadow-card border border-white/[0.06] overflow-hidden min-h-0">
          <FoodPanel />
        </div>
      </div>
    </div>
  )
}
