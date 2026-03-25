import SwiftUI

struct WeatherCard: View {
    let weather: WeatherResponse?

    var body: some View {
        Group {
            if let w = weather {
                let next = nextChange(w)
                let later = laterOutlook(w)

                HStack(spacing: 0) {
                    // NOW — big and prominent
                    weatherColumn(
                        label: "Nå",
                        icon: w.current.symbolCode.weatherSFSymbol,
                        temp: Int(round(w.current.temperature)),
                        big: true
                    )

                    // NEXT — next significant change today
                    if let next = next {
                        divider
                        weatherColumn(
                            label: next.label,
                            icon: next.icon,
                            temp: next.temp,
                            big: false
                        )
                    }

                    // LATER — tomorrow/outlook
                    if let later = later {
                        divider
                        weatherColumn(
                            label: later.label,
                            icon: later.icon,
                            temp: later.temp,
                            big: false
                        )
                    }
                }
            } else {
                ProgressView().tint(Theme.muted)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Theme.card)
        .cornerRadius(Theme.cardCorner)
    }

    // MARK: - Column

    private func weatherColumn(label: String, icon: String, temp: Int, big: Bool) -> some View {
        VStack(spacing: 1) {
            Text(label)
                .font(.system(size: 9, weight: .medium, design: .rounded))
                .foregroundColor(Theme.muted)
                .textCase(.uppercase)

            Image(systemName: icon)
                .symbolRenderingMode(.multicolor)
                .font(.system(size: big ? 28 : 20))

            Text("\(temp)°")
                .font(.system(size: big ? 24 : 17, weight: .bold, design: .rounded))
                .foregroundColor(Theme.text)
        }
        .frame(maxWidth: .infinity)
    }

    private var divider: some View {
        Rectangle()
            .fill(Theme.muted.opacity(0.15))
            .frame(width: 1, height: 36)
    }

    // MARK: - Next change (today)

    private struct WeatherSlot {
        let label: String
        let icon: String
        let temp: Int
    }

    private func nextChange(_ w: WeatherResponse) -> WeatherSlot? {
        let upcoming = upcomingHours(w, count: 12)
        guard !upcoming.isEmpty else { return nil }

        let currentSymbol = w.current.symbolCode

        // Find first hour where weather changes significantly
        for hour in upcoming {
            let isDifferent = weatherCategory(hour.symbolCode) != weatherCategory(currentSymbol)
            let bigTempShift = abs(hour.temperature - w.current.temperature) > 4

            if isDifferent || bigTempShift {
                return WeatherSlot(
                    label: "kl \(hourString(from: hour.time))",
                    icon: hour.symbolCode.weatherSFSymbol,
                    temp: Int(round(hour.temperature))
                )
            }
        }

        // No significant change — show midpoint of the day
        let mid = upcoming[upcoming.count / 2]
        return WeatherSlot(
            label: "kl \(hourString(from: mid.time))",
            icon: mid.symbolCode.weatherSFSymbol,
            temp: Int(round(mid.temperature))
        )
    }

    // MARK: - Later outlook (tomorrow)

    private func laterOutlook(_ w: WeatherResponse) -> WeatherSlot? {
        guard let daily = w.daily, daily.count >= 2,
              let tomorrow = daily.dropFirst().first,
              let max = tomorrow.temperatureMax,
              let symbol = tomorrow.symbolCode else { return nil }

        return WeatherSlot(
            label: "I morgen",
            icon: symbol.weatherSFSymbol,
            temp: Int(round(max))
        )
    }

    // MARK: - Helpers

    private func weatherCategory(_ code: String) -> String {
        if code.contains("rain") { return "rain" }
        if code.contains("snow") { return "snow" }
        if code.contains("sleet") { return "sleet" }
        if code.contains("thunder") { return "thunder" }
        if code.contains("fog") { return "fog" }
        if code.contains("clearsky") { return "clear" }
        if code.contains("fair") || code.contains("partlycloudy") { return "partly" }
        return "cloudy"
    }

    private func upcomingHours(_ w: WeatherResponse, count: Int) -> [WeatherHourly] {
        let now = Date()
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fallback = ISO8601DateFormatter()
        fallback.formatOptions = [.withInternetDateTime]

        return w.hourly.filter { hour in
            if let d = formatter.date(from: hour.time) ?? fallback.date(from: hour.time) {
                return d > now
            }
            return false
        }.prefix(count).map { $0 }
    }
}

// MARK: - Weather colors

extension String {
    var weatherColor: Color {
        switch self {
        case _ where contains("clearsky"):
            return .yellow
        case _ where contains("fair"), _ where contains("partlycloudy"):
            return .white
        case _ where contains("cloudy"):
            return .white
        case _ where contains("rain"):
            return .blue
        case _ where contains("sleet"):
            return .cyan
        case _ where contains("snow"):
            return .white
        case _ where contains("fog"):
            return .gray
        case _ where contains("thunder"):
            return .yellow
        default:
            return .white
        }
    }
}

// MARK: - Preview

struct WeatherCard_Previews: PreviewProvider {
    static var previews: some View {
        WeatherCard(weather: mockAlerts)
            .padding()
            .background(Theme.background)
            .preferredColorScheme(.dark)
            .previewLayout(.sizeThatFits)
            .previewDisplayName("Rain coming")

        WeatherCard(weather: mockClear)
            .padding()
            .background(Theme.background)
            .preferredColorScheme(.dark)
            .previewLayout(.sizeThatFits)
            .previewDisplayName("Clear day")
    }

    static var mockAlerts: WeatherResponse {
        let futureHours: [WeatherHourly] = (1...12).map { offset in
            let time = ISO8601DateFormatter().string(from: Date().addingTimeInterval(Double(offset) * 3600))
            let hasRain = offset >= 4 && offset <= 8
            return WeatherHourly(
                time: time,
                temperature: 8.0 + (hasRain ? -2.0 : Double(offset) * 0.3),
                precipitation: hasRain ? 2.5 : 0.0,
                symbolCode: hasRain ? "lightrainshowers_day" : "partlycloudy_day"
            )
        }
        return WeatherResponse(
            current: WeatherCurrent(
                time: ISO8601DateFormatter().string(from: Date()),
                temperature: 9.0, windSpeed: 4.2, windDirection: 220,
                humidity: 72, precipitation: 0.0, symbolCode: "partlycloudy_day"
            ),
            hourly: futureHours,
            daily: [
                WeatherDaily(date: "2026-03-20", temperatureMin: 4, temperatureMax: 10, symbolCode: "partlycloudy_day"),
                WeatherDaily(date: "2026-03-21", temperatureMin: 1, temperatureMax: 4, symbolCode: "lightrainshowers_day"),
                WeatherDaily(date: "2026-03-22", temperatureMin: -2, temperatureMax: 2, symbolCode: "heavysnowshowers_day"),
            ],
            updatedAt: ""
        )
    }

    static var mockClear: WeatherResponse {
        let futureHours: [WeatherHourly] = (1...12).map { offset in
            let time = ISO8601DateFormatter().string(from: Date().addingTimeInterval(Double(offset) * 3600))
            return WeatherHourly(
                time: time, temperature: 18.0 + Double(offset) * 0.2,
                precipitation: 0.0, symbolCode: "clearsky_day"
            )
        }
        return WeatherResponse(
            current: WeatherCurrent(
                time: ISO8601DateFormatter().string(from: Date()),
                temperature: 18.0, windSpeed: 2.1, windDirection: 180,
                humidity: 45, precipitation: 0.0, symbolCode: "clearsky_day"
            ),
            hourly: futureHours,
            daily: [
                WeatherDaily(date: "2026-03-20", temperatureMin: 12, temperatureMax: 19, symbolCode: "clearsky_day"),
                WeatherDaily(date: "2026-03-21", temperatureMin: 13, temperatureMax: 20, symbolCode: "fair_day"),
                WeatherDaily(date: "2026-03-22", temperatureMin: 14, temperatureMax: 21, symbolCode: "clearsky_day")
            ],
            updatedAt: ""
        )
    }
}
