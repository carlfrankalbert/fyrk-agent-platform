import Foundation

// MARK: - Weather

struct WeatherResponse: Codable {
    let current: WeatherCurrent
    let hourly: [WeatherHourly]
    let daily: [WeatherDaily]?
    let updatedAt: String
}

struct WeatherCurrent: Codable {
    let time: String
    let temperature: Double
    let windSpeed: Double
    let windDirection: Double
    let humidity: Double
    let precipitation: Double
    let symbolCode: String
}

struct WeatherHourly: Codable {
    let time: String
    let temperature: Double
    let precipitation: Double
    let symbolCode: String
}

struct WeatherDaily: Codable {
    let date: String?
    let temperatureMin: Double?
    let temperatureMax: Double?
    let symbolCode: String?
}

// MARK: - Transport

struct TransportResponse: Codable {
    let stopName: String
    let departures: [Departure]
    let updatedAt: String
}

struct Departure: Codable, Identifiable {
    var id: String { "\(line)-\(destination)-\(departureTime)" }
    let line: String
    let destination: String
    let departureTime: String
    let aimedTime: String
    let realtime: Bool
    let delayed: Bool
    let delayMinutes: Int
    let cancelled: Bool
    let transportMode: String

    var minutesUntil: Int {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: departureTime) {
            return max(0, Int(date.timeIntervalSinceNow / 60))
        }
        // Try without fractional seconds
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: departureTime) {
            return max(0, Int(date.timeIntervalSinceNow / 60))
        }
        return 0
    }

    var minutesText: String {
        let m = minutesUntil
        if m <= 0 { return "Nå" }
        return "\(m) min"
    }
}

// MARK: - Meals

struct MealsResponse: Codable {
    let plan: MealPlan?
}

struct MealPlan: Codable {
    let planId: String?
    let weekNumber: Int
    let year: Int
    let status: String
    let meals: [Meal]
}

struct Meal: Codable, Identifiable {
    var id: String { "\(dayOfWeek)-\(name)" }
    let dayOfWeek: Int
    let dayName: String
    let name: String
    let description: String?
    let mealType: String
    let yieldsLeftovers: Bool
}

// MARK: - Shopping

struct ShoppingResponse: Codable {
    let listId: String
    var items: [ShoppingItem]
}

struct ShoppingItem: Codable, Identifiable {
    let id: String
    let name: String
    let amount: Double?
    let unit: String?
    let category: String?
    var checked: Bool
}

// MARK: - Calendar

struct CalendarResponse: Codable {
    let events: [CalendarEvent]
    let updatedAt: String
}

struct CalendarEvent: Codable, Identifiable {
    let id: String
    let title: String
    let startTime: String
    let endTime: String
    let allDay: Bool
    let location: String?
    let description: String?
    let calendar: String
    let color: String?

    var timeString: String {
        if allDay { return "Hele dagen" }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = formatter.date(from: startTime)
        if date == nil {
            formatter.formatOptions = [.withInternetDateTime]
            date = formatter.date(from: startTime)
        }
        guard let d = date else { return "" }
        let df = DateFormatter()
        df.dateFormat = "HH:mm"
        df.timeZone = TimeZone.current
        return df.string(from: d)
    }

    var isNow: Bool {
        guard !allDay else { return true }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let start = formatter.date(from: startTime),
              let end = formatter.date(from: endTime) else { return false }
        let now = Date()
        return now >= start && now <= end
    }
}

// MARK: - Reminders

struct RemindersResponse: Codable {
    var reminders: [Reminder]
}

struct Reminder: Codable, Identifiable {
    let id: String
    let title: String
    let emoji: String
    let recurrence: String
}

struct CreateReminderRequest: Codable {
    let title: String
    let emoji: String
    let recurrence: String
}

// MARK: - Auth

struct VerifyCodeRequest: Codable {
    let code: String
}

struct VerifyResponse: Codable {
    let ok: Bool
    let token: String
    let expiresAt: String
}

struct AuthMeResponse: Codable {
    let email: String
}

struct AddItemsRequest: Codable {
    let items: [NewItem]
}

struct NewItem: Codable {
    let name: String
}

struct CheckedUpdate: Codable {
    let checked: Bool
}

struct RateMealRequest: Codable {
    let dayOfWeek: Int
    let feedbackEmoji: String
}

// MARK: - Child Profiles

struct ChildProfilesResponse: Codable {
    let children: [ChildProfile]
}

struct ChildProfile: Codable, Identifiable {
    let name: String
    let likes: [String]
    let dislikes: [String]

    var id: String { name }
}

// MARK: - Voice

struct VoiceRequest: Codable {
    let text: String
}

struct VoiceResponse: Codable {
    let reply: String
    let action: String?
}

// MARK: - Weather Helpers

extension String {
    var weatherSFSymbol: String {
        switch self {
        case _ where contains("clearsky"):
            return "sun.max.fill"
        case _ where contains("fair"):
            return "cloud.sun.fill"
        case _ where contains("partlycloudy"):
            return "cloud.sun.fill"
        case _ where contains("cloudy"):
            return "cloud.fill"
        case _ where contains("heavyrain") || contains("heavyrainshowers"):
            return "cloud.heavyrain.fill"
        case _ where contains("lightrain") || contains("lightrainshowers"):
            return "cloud.drizzle.fill"
        case _ where contains("rain") || contains("rainshowers"):
            return "cloud.rain.fill"
        case _ where contains("sleet"):
            return "cloud.sleet.fill"
        case _ where contains("heavysnow") || contains("heavysnowshowers"):
            return "cloud.snow.fill"
        case _ where contains("lightsnow") || contains("lightsnowshowers"):
            return "cloud.snow.fill"
        case _ where contains("snow") || contains("snowshowers"):
            return "cloud.snow.fill"
        case _ where contains("fog"):
            return "cloud.fog.fill"
        case _ where contains("thunder"):
            return "cloud.bolt.rain.fill"
        default:
            return "cloud.fill"
        }
    }

    var weatherDescription: String {
        switch self {
        case _ where contains("clearsky"): return "Klarvær"
        case _ where contains("fair"): return "Lettskyet"
        case _ where contains("partlycloudy"): return "Delvis skyet"
        case _ where contains("cloudy"): return "Skyet"
        case _ where contains("heavyrain"): return "Kraftig regn"
        case _ where contains("lightrain"): return "Lett regn"
        case _ where contains("rain"): return "Regn"
        case _ where contains("sleet"): return "Sludd"
        case _ where contains("heavysnow"): return "Kraftig snø"
        case _ where contains("lightsnow"): return "Lett snø"
        case _ where contains("snow"): return "Snø"
        case _ where contains("fog"): return "Tåke"
        case _ where contains("thunder"): return "Torden"
        default: return "Skyet"
        }
    }
}

// MARK: - Clothing recommendation

func clothingRecommendation(temp: Double, precipitation: Double, wind: Double) -> (text: String, icon: String) {
    if precipitation > 1.0 {
        return ("Regnjakke", "cloud.rain.fill")
    }
    if temp < -5 {
        return ("Vinterjakke", "snowflake")
    }
    if temp < 5 {
        return ("Varm jakke", "thermometer.snowflake")
    }
    if temp < 12 {
        return ("Lett jakke", "wind")
    }
    if temp < 18 {
        return ("Genser", "tshirt.fill")
    }
    return ("T-skjorte", "sun.max.fill")
}

// MARK: - Meal emoji

func mealEmoji(for name: String) -> String {
    let lower = name.lowercased()
    if lower.contains("pizza") { return "🍕" }
    if lower.contains("pasta") || lower.contains("spaghetti") || lower.contains("bolognese") { return "🍝" }
    if lower.contains("taco") { return "🌮" }
    if lower.contains("sushi") { return "🍣" }
    if lower.contains("suppe") { return "🍲" }
    if lower.contains("salat") { return "🥗" }
    if lower.contains("burger") { return "🍔" }
    if lower.contains("kylling") || lower.contains("chicken") { return "🍗" }
    if lower.contains("fisk") || lower.contains("laks") || lower.contains("torsk") { return "🐟" }
    if lower.contains("biff") || lower.contains("steak") { return "🥩" }
    if lower.contains("wok") { return "🥘" }
    if lower.contains("gryte") { return "🫕" }
    if lower.contains("pølse") { return "🌭" }
    if lower.contains("rest") || lower.contains("leftover") { return "♻️" }
    if lower.contains("brød") || lower.contains("toast") { return "🍞" }
    if lower.contains("egg") || lower.contains("omelett") { return "🍳" }
    if lower.contains("ris") || lower.contains("rice") { return "🍚" }
    if lower.contains("curry") { return "🍛" }
    return "🍽️"
}

// MARK: - Day helpers

func todayDayOfWeek() -> Int {
    let weekday = Calendar.current.component(.weekday, from: Date())
    // Calendar weekday: 1=Sunday, 2=Monday, ... 7=Saturday
    // API dayOfWeek: 1=Monday, ... 7=Sunday
    return weekday == 1 ? 7 : weekday - 1
}

func hourString(from isoString: String) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    var date = formatter.date(from: isoString)
    if date == nil {
        formatter.formatOptions = [.withInternetDateTime]
        date = formatter.date(from: isoString)
    }
    guard let d = date else { return "--" }
    let df = DateFormatter()
    df.dateFormat = "HH"
    df.timeZone = TimeZone.current
    return df.string(from: d)
}
