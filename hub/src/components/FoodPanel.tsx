import { useState, useCallback } from 'react'
import { api, type MealsWeekData, type ShoppingData } from '../lib/api'
import { usePolling } from '../hooks/usePolling'

const DAY_SHORT = ['', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lor', 'Son']

function getTodayIsoDay(): number {
  const jsDay = new Date().getDay()
  return jsDay === 0 ? 7 : jsDay
}

function isToday(dayOfWeek: number): boolean {
  return dayOfWeek === getTodayIsoDay()
}

function isPast(dayOfWeek: number): boolean {
  return dayOfWeek < getTodayIsoDay()
}

function getMealIcon(mealType: string, name: string): string {
  const lower = (mealType + ' ' + name).toLowerCase()
  if (lower.includes('fisk') || lower.includes('laks') || lower.includes('torsk') || lower.includes('sei')) return '🐟'
  if (lower.includes('vegetar') || lower.includes('gronn') || lower.includes('salat')) return '🥬'
  if (lower.includes('pasta') || lower.includes('spaghetti') || lower.includes('lasagne')) return '🍝'
  if (lower.includes('kylling') || lower.includes('chicken')) return '🍗'
  if (lower.includes('kjott') || lower.includes('biff') || lower.includes('svin') || lower.includes('lam')) return '🥩'
  return '🍽'
}

function DayCard({ meal, isActive, dimmed }: {
  meal: MealsWeekData['plan']['meals'][0]
  isActive: boolean
  dimmed: boolean
}) {
  const icon = getMealIcon(meal.mealType, meal.name)

  return (
    <div
      className={`flex flex-col rounded-[14px] transition-all ${
        isActive
          ? 'bg-hub-surface border-t-[3px] border-t-hub-accent border border-white/[0.06] flex-[1.3] min-w-[150px] p-4 shadow-[0_0_20px_rgba(129,140,248,0.08)]'
          : `bg-hub-surface/40 border border-white/[0.06] flex-1 min-w-[100px] p-3`
      } ${dimmed ? 'opacity-30' : ''}`}
    >
      {/* Day name */}
      <div className={`font-semibold uppercase tracking-[0.1em] mb-2 ${
        isActive ? 'text-hub-accent text-[13px]' : 'text-hub-muted/70 text-[11px]'
      }`}>
        {isActive ? 'I dag' : DAY_SHORT[meal.dayOfWeek]}
      </div>

      {/* Meal icon */}
      <div className={`mb-1.5 ${isActive ? 'text-[22px]' : 'text-[17px]'}`}>
        {icon}
      </div>

      {/* Meal name */}
      <div className={`font-semibold text-hub-text leading-snug ${
        isActive ? 'text-[15px]' : 'text-[13px]'
      } ${!isActive ? 'line-clamp-2' : ''}`}>
        {meal.name}
      </div>

      {/* Description (today only) */}
      {isActive && meal.description && (
        <div className="text-[12px] text-hub-muted mt-1.5 leading-relaxed line-clamp-2">
          {meal.description}
        </div>
      )}

      {/* Badges */}
      {meal.yieldsLeftovers && (
        <span className={`inline-flex items-center gap-1 mt-auto pt-2 font-medium text-hub-green ${
          isActive ? 'text-[12px]' : 'text-[10px]'
        }`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="text-hub-green">
            <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Gir rester
        </span>
      )}
    </div>
  )
}

function GhostDayCard({ dayIndex }: { dayIndex: number }) {
  const today = getTodayIsoDay()
  const isActive = dayIndex === today

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-[14px] transition-all ${
        isActive
          ? 'bg-hub-accent/[0.08] border-t-[3px] border-t-hub-accent/40 border border-hub-accent/15 flex-[1.3] min-w-[150px]'
          : 'bg-hub-surface/25 border border-white/[0.05] flex-1 min-w-[100px]'
      } p-3`}
    >
      <div className={`font-semibold uppercase tracking-[0.1em] ${
        isActive ? 'text-hub-accent text-[13px]' : 'text-hub-muted/40 text-[11px]'
      }`}>
        {isActive ? 'I dag' : DAY_SHORT[dayIndex]}
      </div>
      {isActive && (
        <div className="text-[12px] text-hub-muted/40 mt-2">Ingen middag</div>
      )}
    </div>
  )
}

function ShoppingSidebar({ data, onRefresh }: { data: ShoppingData; onRefresh: () => void }) {
  const [newItem, setNewItem] = useState('')

  const handleToggle = async (id: string, checked: boolean) => {
    await api.toggleShoppingItem(id, !checked)
    onRefresh()
  }

  const handleAdd = async () => {
    if (!newItem.trim()) return
    await api.addShoppingItems([{ name: newItem.trim() }])
    setNewItem('')
    onRefresh()
  }

  const unchecked = data.items.filter((i) => !i.checked)
  const displayItems = unchecked.slice(0, 5)
  const remaining = unchecked.length - displayItems.length

  return (
    <div className="w-[200px] flex-shrink-0 bg-hub-surface/60 rounded-[14px] border border-white/[0.07] p-4 flex flex-col">
      {/* Title */}
      <div className="flex items-center justify-between mb-3">
        <span className="label">Handleliste</span>
        {unchecked.length > 0 && (
          <span className="text-[11px] text-hub-accent bg-hub-accent/12 px-1.5 py-0.5 rounded-pill tabular-nums font-semibold">
            {unchecked.length}
          </span>
        )}
      </div>

      {/* Items */}
      <div className="flex-1 space-y-1.5 overflow-hidden">
        {displayItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2.5">
            <div className="w-10 h-10 rounded-[12px] bg-hub-bg/50 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-hub-muted/30">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-[12px] text-hub-muted/40">Alt handlet</span>
          </div>
        ) : (
          displayItems.map((item) => (
            <div key={item.id} className="flex items-center gap-2.5 py-1">
              <input
                type="checkbox"
                checked={false}
                onChange={() => handleToggle(item.id, item.checked)}
                className="checkbox-custom"
              />
              <span className="text-[13px] text-hub-text truncate flex-1">{item.name}</span>
            </div>
          ))
        )}
        {remaining > 0 && (
          <div className="text-[12px] text-hub-accent font-semibold pt-1">
            + {remaining} flere
          </div>
        )}
      </div>

      {/* Add input */}
      <div className="mt-3 pt-3 border-t border-white/[0.06]">
        <input
          type="text"
          placeholder="Legg til..."
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="w-full px-3 py-2 bg-hub-bg/40 rounded-[8px] border border-white/[0.06] text-[13px] text-hub-text placeholder-hub-muted/30 focus-ring transition-colors focus:border-hub-accent/40 outline-none"
        />
      </div>
    </div>
  )
}

export function FoodPanel() {
  const mealsFetcher = useCallback(() => api.mealsWeek(), [])
  const shoppingFetcher = useCallback(() => api.shopping(), [])
  const meals = usePolling<MealsWeekData>(mealsFetcher, 5 * 60 * 1000)
  const shopping = usePolling<ShoppingData>(shoppingFetcher, 30 * 1000)

  const isLoading = meals.loading || !meals.data

  return (
    <div className="h-full flex flex-col p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="label">Ukemeny</div>
        {meals.data && (
          <span className="text-[11px] text-hub-muted/40 tabular-nums font-medium">
            Uke {meals.data.plan.weekNumber}
          </span>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-hub-accent animate-spin" />
        </div>
      ) : meals.data!.plan.meals.length === 0 ? (
        /* Empty state — designed ghost cards */
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 flex gap-2 min-w-0">
            {/* Ghost day cards */}
            <div className="flex-1 flex gap-2 min-w-0">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <GhostDayCard key={d} dayIndex={d} />
              ))}
            </div>

            {/* Shopping sidebar */}
            {shopping.data && (
              <ShoppingSidebar data={shopping.data} onRefresh={shopping.refresh} />
            )}
          </div>

          {/* Bottom CTA */}
          <div className="flex items-center justify-center gap-3 pt-4 mt-2">
            <span className="text-[13px] text-hub-muted/50">Ukens meny planlegges med Husmor</span>
            <button className="text-[13px] text-hub-accent font-semibold px-4 py-1.5 rounded-[8px] bg-hub-accent/10 border border-hub-accent/20 hover:bg-hub-accent/15 transition-colors">
              Start planlegging
            </button>
          </div>
        </div>
      ) : (
        /* Meal cards + shopping sidebar */
        <div className="flex-1 flex gap-3 min-h-0">
          {/* Day cards row */}
          <div className="flex-1 flex gap-2 min-w-0 overflow-x-auto hide-scrollbar">
            {[...meals.data!.plan.meals]
              .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
              .map((meal) => (
                <DayCard
                  key={`${meal.dayOfWeek}-${meal.mealType}`}
                  meal={meal}
                  isActive={isToday(meal.dayOfWeek)}
                  dimmed={isPast(meal.dayOfWeek)}
                />
              ))}
          </div>

          {/* Shopping sidebar */}
          {shopping.data && (
            <ShoppingSidebar data={shopping.data} onRefresh={shopping.refresh} />
          )}
        </div>
      )}
    </div>
  )
}
