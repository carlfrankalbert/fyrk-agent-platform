import { useCallback } from 'react'
import { api, type WeatherData } from '../lib/api'
import { usePolling } from '../hooks/usePolling'

const YR_SVG_BASE = 'https://raw.githubusercontent.com/nrkno/yr-weather-symbols/master/symbols/darkmode'

/** Map Yr symbol codes to NRK icon file IDs */
const SYMBOL_TO_ICON: Record<string, string> = {
  clearsky_day: '01d', clearsky_night: '01n', clearsky_polartwilight: '01m',
  fair_day: '02d', fair_night: '02n', fair_polartwilight: '02m',
  partlycloudy_day: '03d', partlycloudy_night: '03n', partlycloudy_polartwilight: '03m',
  cloudy: '04',
  rainshowers_day: '05d', rainshowers_night: '05n', rainshowers_polartwilight: '05m',
  rainshowersandthunder_day: '06d', rainshowersandthunder_night: '06n',
  sleetshowers_day: '07d', sleetshowers_night: '07n',
  snowshowers_day: '08d', snowshowers_night: '08n',
  rain: '09', heavyrain: '10', heavyrainandthunder: '11',
  sleet: '12', snow: '13', snowandthunder: '14', fog: '15',
  sleetshowersandthunder_day: '20d', sleetshowersandthunder_night: '20n',
  snowshowersandthunder_day: '21d', snowshowersandthunder_night: '21n',
  rainandthunder: '22', sleetandthunder: '23',
  lightrainshowersandthunder_day: '24d', lightrainshowersandthunder_night: '24n',
  heavyrainshowersandthunder_day: '25d', heavyrainshowersandthunder_night: '25n',
  lightrainandthunder: '30', lightsleetandthunder: '31',
  heavysleetandthunder: '32', lightsnowandthunder: '33', heavysnowandthunder: '34',
  lightrainshowers_day: '40d', lightrainshowers_night: '40n',
  heavyrainshowers_day: '41d', heavyrainshowers_night: '41n',
  lightsleetshowers_day: '42d', lightsleetshowers_night: '42n',
  heavysleetshowers_day: '43d', heavysleetshowers_night: '43n',
  lightsnowshowers_day: '44d', lightsnowshowers_night: '44n',
  heavysnowshowers_day: '45d', heavysnowshowers_night: '45n',
  lightrain: '46', lightsleet: '47', heavysleet: '48',
  lightsnow: '49', heavysnow: '50',
}

function symbolToIconId(code: string): string {
  return SYMBOL_TO_ICON[code] ?? SYMBOL_TO_ICON[code.replace(/_(day|night|polartwilight)$/, '')] ?? '04'
}

const SYMBOL_DESCRIPTIONS: Record<string, string> = {
  clearsky_day: 'Klarvær',
  clearsky_night: 'Klarvær',
  clearsky_polartwilight: 'Klarvær',
  fair_day: 'Lettskyet',
  fair_night: 'Lettskyet',
  fair_polartwilight: 'Lettskyet',
  partlycloudy_day: 'Delvis skyet',
  partlycloudy_night: 'Delvis skyet',
  partlycloudy_polartwilight: 'Delvis skyet',
  cloudy: 'Skyet',
  rain: 'Regn',
  lightrain: 'Lett regn',
  heavyrain: 'Kraftig regn',
  lightrainshowers_day: 'Lette regnbyger',
  lightrainshowers_night: 'Lette regnbyger',
  rainshowers_day: 'Regnbyger',
  rainshowers_night: 'Regnbyger',
  heavyrainshowers_day: 'Kraftige regnbyger',
  heavyrainshowers_night: 'Kraftige regnbyger',
  snow: 'Sno',
  lightsnow: 'Lett sno',
  heavysnow: 'Kraftig sno',
  snowshowers_day: 'Snobyger',
  snowshowers_night: 'Snobyger',
  sleet: 'Sludd',
  sleetshowers_day: 'Sluddbyger',
  sleetshowers_night: 'Sluddbyger',
  fog: 'Take',
  lightrainandthunder: 'Lett regn og torden',
  rainandthunder: 'Regn og torden',
  heavyrainandthunder: 'Kraftig regn og torden',
  lightssleetandthunder: 'Lett sludd og torden',
  snowandthunder: 'Sno og torden',
}

function getDescription(code: string): string {
  if (SYMBOL_DESCRIPTIONS[code]) return SYMBOL_DESCRIPTIONS[code]
  const base = code.replace(/_(day|night|polartwilight)$/, '')
  if (SYMBOL_DESCRIPTIONS[base]) return SYMBOL_DESCRIPTIONS[base]
  if (code.includes('rain')) return 'Regn'
  if (code.includes('snow')) return 'Sno'
  if (code.includes('sleet')) return 'Sludd'
  if (code.includes('thunder')) return 'Torden'
  if (code.includes('fog')) return 'Take'
  if (code.includes('cloudy')) return 'Skyet'
  if (code.includes('fair')) return 'Lettskyet'
  if (code.includes('clear')) return 'Klarvær'
  return 'Varierende'
}

function isRainy(code: string): boolean {
  return code.includes('rain') || code.includes('sleet')
}

function getWeatherRecommendation(temp: number, symbolCode: string): { text: string; emoji: string } {
  const rain = isRainy(symbolCode)
  if (temp < 0) return { text: 'Vinterdress', emoji: '🧥' }
  if (temp < 5 && rain) return { text: 'Regntoy', emoji: '🌧' }
  if (temp < 5) return { text: 'Varm jakke', emoji: '🧥' }
  if (temp < 12 && rain) return { text: 'Regnjakke', emoji: '☂️' }
  if (temp < 12) return { text: 'Lett jakke', emoji: '🧤' }
  if (temp < 18) return { text: 'Genser', emoji: '👕' }
  return { text: 'T-skjorte-vær!', emoji: '☀️' }
}

function formatTemp(t: number): string {
  const rounded = Math.round(t)
  return rounded > 0 ? `+${rounded}°` : `${rounded}°`
}

function formatHour(iso: string): string {
  return new Date(iso).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
}

function windDirectionLabel(deg: number): string {
  const dirs = ['N', 'NO', 'O', 'SO', 'S', 'SV', 'V', 'NV']
  return dirs[Math.round(deg / 45) % 8]
}

function WeatherIcon({ code, size = 40 }: { code: string; size?: number }) {
  const iconId = symbolToIconId(code)
  return (
    <img
      src={`${YR_SVG_BASE}/${iconId}.svg`}
      alt={getDescription(code)}
      width={size}
      height={size}
      className="drop-shadow-sm"
      loading="eager"
    />
  )
}

export function WeatherPanel() {
  const fetcher = useCallback(() => api.weather(), [])
  const { data, loading } = usePolling<WeatherData>(fetcher, 10 * 60 * 1000)

  if (loading || !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-hub-accent animate-spin" />
          <span className="text-xs text-hub-muted">Laster vær...</span>
        </div>
      </div>
    )
  }

  const { current, hourly } = data
  const next5h = hourly.slice(1, 6)
  const rec = getWeatherRecommendation(current.temperature, current.symbolCode)

  return (
    <div className="h-full flex flex-col p-5">
      {/* Header */}
      <div className="label mb-3">Vær</div>

      {/* Current weather + wind inline */}
      <div className="flex items-center gap-4 mb-3">
        <WeatherIcon code={current.symbolCode} size={48} />
        <div>
          <div className="text-[34px] font-bold tracking-tight leading-none text-hub-text">
            {formatTemp(current.temperature)}
          </div>
          <div className="text-[13px] text-hub-muted mt-1">
            {getDescription(current.symbolCode)} &middot; {Math.round(current.windSpeed)} m/s {windDirectionLabel(current.windDirection)}
            {current.precipitation > 0 && ` · ${current.precipitation} mm`}
          </div>
        </div>
      </div>

      {/* Clothing recommendation pill */}
      <div className="flex items-center gap-2 mb-3 px-3 py-1.5 bg-hub-surface/70 rounded-[10px] border border-white/[0.04]">
        <span className="text-[13px]">{rec.emoji}</span>
        <span className="text-[13px] text-hub-text font-medium">{rec.text}</span>
      </div>

      {/* Hourly forecast strip */}
      <div className="label mb-2">Neste timer</div>
      <div className="hourly-strip hide-scrollbar flex-1">
        {next5h.map((h) => (
          <div
            key={h.time}
            className="flex flex-col items-center gap-1 bg-hub-surface/50 rounded-[12px] px-3 py-2 min-w-[58px] border border-white/[0.03]"
          >
            <span className="text-[11px] text-hub-muted font-medium">{formatHour(h.time)}</span>
            <WeatherIcon code={h.symbolCode} size={24} />
            <span className="text-[13px] font-semibold text-hub-text">{formatTemp(h.temperature)}</span>
            {h.precipitation > 0 && (
              <span className="text-[10px] text-blue-400/80 font-medium">{h.precipitation}mm</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
