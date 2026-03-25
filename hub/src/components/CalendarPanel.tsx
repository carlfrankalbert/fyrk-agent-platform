import { useCallback } from 'react'
import { api, type MealsWeekData } from '../lib/api'
import { usePolling } from '../hooks/usePolling'

function getTodayIsoDay(): number {
  const jsDay = new Date().getDay()
  return jsDay === 0 ? 7 : jsDay
}

const REMINDERS = [
  { icon: '🎒', text: 'Gympose' },
  { icon: '🗑', text: 'Soppel ut' },
  { icon: '🔑', text: 'Nokler' },
]

export function CalendarPanel() {
  const now = new Date()
  const dayName = now.toLocaleDateString('nb-NO', { weekday: 'long' })
  const dayNum = now.getDate()
  const monthName = now.toLocaleDateString('nb-NO', { month: 'long' })

  const mealsFetcher = useCallback(() => api.mealsWeek(), [])
  const { data: mealsData } = usePolling<MealsWeekData>(mealsFetcher, 5 * 60 * 1000)

  const todayIso = getTodayIsoDay()
  const todayMeal = mealsData?.plan.meals.find((m) => m.dayOfWeek === todayIso)

  return (
    <div className="h-full flex flex-col p-5">
      {/* Header */}
      <div className="label mb-3">I dag</div>

      {/* Date display */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-[46px] h-[46px] rounded-[12px] bg-hub-accent/15 flex items-center justify-center">
          <span className="text-[28px] font-bold text-hub-accent leading-none">{dayNum}</span>
        </div>
        <div>
          <div className="text-[17px] font-semibold text-hub-text capitalize leading-tight">{dayName}</div>
          <div className="text-[12px] text-hub-muted mt-0.5">{dayNum}. {monthName}</div>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-white/[0.06] mb-3" />

      {/* Today's dinner */}
      <div className="mb-3">
        <div className="text-[11px] font-semibold text-hub-muted uppercase tracking-[0.1em] mb-1.5">
          Dagens middag
        </div>
        {todayMeal ? (
          <div className="bg-hub-surface rounded-[12px] px-3.5 py-2.5 border border-white/[0.04]">
            <div className="text-[15px] font-semibold text-hub-text leading-snug">
              {todayMeal.name}
            </div>
            {todayMeal.description && (
              <div className="text-[12px] text-hub-muted mt-1 leading-relaxed line-clamp-2">
                {todayMeal.description}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-hub-surface/50 rounded-[12px] px-3.5 py-2.5 border border-white/[0.04]">
            <span className="text-[13px] text-hub-muted/60 italic">Ikke planlagt enna</span>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="h-px bg-white/[0.06] mb-3" />

      {/* Reminders */}
      <div className="flex-1 min-h-0">
        <div className="text-[11px] font-semibold text-hub-muted uppercase tracking-[0.1em] mb-2">
          Husk i dag
        </div>
        <div className="space-y-1.5">
          {REMINDERS.map((r) => (
            <div
              key={r.text}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-[8px] bg-hub-surface/60 border border-white/[0.03] border-l-2 border-l-hub-yellow/50"
            >
              <span className="text-[13px]">{r.icon}</span>
              <span className="text-[13px] text-hub-text font-medium">{r.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
