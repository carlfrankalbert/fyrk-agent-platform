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

// MARK: - Generate Meal Plan

struct GenerateMealPlanRequest: Codable {
    let skipDays: [Int]
    let prefilledMeals: [[String: String]]
    let kitchenContext: String?
    let weekOffset: Int?
}

// MARK: - Meals Chat

struct MealsChatMessage: Codable {
    let role: String
    let content: String
}

struct MealsChatRequest: Codable {
    let messages: [MealsChatMessage]
}

struct MealsChatResponse: Codable {
    let reply: String
    let extracted: MealsChatExtracted?
}

struct MealsChatExtracted: Codable {
    let ingredients: [String]?
    let preferences: [String]?
    let needToBuy: [String]?
    let context: String?
}

struct GenerateMealPlanResponse: Codable {
    let ok: Bool
    let reply: String?
    let days: [GeneratedDay]?
}

struct GeneratedDay: Codable {
    let dayOfWeek: Int
    let date: String?           // ISO date "2026-03-24"
    let contextLine: String?    // "Henting 17:00", "Rolig dag"
    let busyness: String?       // "rolig", "normal", "travel"
    let options: [MealOption]
}

struct MealOption: Codable, Identifiable {
    var id: String { name }
    let name: String
    let description: String?
    let category: String?
    let reasoning: String?      // Why this meal fits this day
    let planB: String?          // Fallback — shares ingredients with Plan A or uses staples
    let cookTimeMin: Int?       // Estimated cooking time in minutes
    let startTime: String?      // Recommended start time "HH:mm"
}

struct ConfirmMealsRequest: Codable {
    let meals: [ConfirmMeal]
    let weekOffset: Int?
}

struct ConfirmMeal: Codable {
    let dayOfWeek: Int
    let name: String
    let description: String?
    var mealType: String?
    var yieldsLeftovers: Bool?
    var suggestedBy: String?    // "husmor" or "user"
}

// MARK: - Meal source tracking

enum MealSource: String {
    case husmor     // Claude suggested
    case user       // User chose manually
    case locked     // Locked by user
    case notDecided // No choice yet
}

// MARK: - Day planning modes

enum DayMode: Equatable {
    case generate           // Claude picks
    case prefilled(String)  // User typed a meal
    case away               // Nobody home
    case fewerPeople        // Reduced servings
    case leftovers          // Use leftovers
    case takeaway(Cuisine?) // Ordering in, optional cuisine

    var needsGeneration: Bool {
        if case .generate = self { return true }
        if case .fewerPeople = self { return true }
        return false
    }

    var isSpecial: Bool {
        switch self {
        case .generate, .prefilled: return false
        default: return true
        }
    }
}

struct Cuisine: Equatable, Identifiable {
    let id: String       // country code
    let flag: String
    let name: String     // Norwegian name
}

let popularCuisines: [Cuisine] = [
    Cuisine(id: "it", flag: "\u{1F1EE}\u{1F1F9}", name: "Italiensk"),
    Cuisine(id: "in", flag: "\u{1F1EE}\u{1F1F3}", name: "Indisk"),
    Cuisine(id: "th", flag: "\u{1F1F9}\u{1F1ED}", name: "Thai"),
    Cuisine(id: "jp", flag: "\u{1F1EF}\u{1F1F5}", name: "Japansk"),
    Cuisine(id: "mx", flag: "\u{1F1F2}\u{1F1FD}", name: "Meksikansk"),
    Cuisine(id: "cn", flag: "\u{1F1E8}\u{1F1F3}", name: "Kinesisk"),
    Cuisine(id: "kr", flag: "\u{1F1F0}\u{1F1F7}", name: "Koreansk"),
    Cuisine(id: "vn", flag: "\u{1F1FB}\u{1F1F3}", name: "Vietnamesisk"),
    Cuisine(id: "tr", flag: "\u{1F1F9}\u{1F1F7}", name: "Tyrkisk"),
    Cuisine(id: "gr", flag: "\u{1F1EC}\u{1F1F7}", name: "Gresk"),
    Cuisine(id: "lb", flag: "\u{1F1F1}\u{1F1E7}", name: "Libanesisk"),
    Cuisine(id: "us", flag: "\u{1F1FA}\u{1F1F8}", name: "Amerikansk"),
    Cuisine(id: "fr", flag: "\u{1F1EB}\u{1F1F7}", name: "Fransk"),
    Cuisine(id: "es", flag: "\u{1F1EA}\u{1F1F8}", name: "Spansk"),
    Cuisine(id: "et", flag: "\u{1F1EA}\u{1F1F9}", name: "Etiopisk"),
    Cuisine(id: "no", flag: "\u{1F1F3}\u{1F1F4}", name: "Norsk"),
    Cuisine(id: "pe", flag: "\u{1F1F5}\u{1F1EA}", name: "Peruansk"),
    Cuisine(id: "ma", flag: "\u{1F1F2}\u{1F1E6}", name: "Marokkansk"),
]

// MARK: - Recipes

struct RecipesResponse: Codable {
    let recipes: [RecipeSummary]
}

struct RecipeSummary: Codable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let tags: [String]?
    let prepTimeMin: Int?
    let cookTimeMin: Int?
    let servings: Int?
    let nutritionPerServing: NutritionInfo?

    enum CodingKeys: String, CodingKey {
        case id, name, description, tags, servings
        case prepTimeMin = "prep_time_min"
        case cookTimeMin = "cook_time_min"
        case nutritionPerServing = "nutrition_per_serving"
    }
}

struct NutritionInfo: Codable {
    let calories: Double?
    let proteinG: Double?
    let fiberG: Double?

    enum CodingKeys: String, CodingKey {
        case calories
        case proteinG = "protein_g"
        case fiberG = "fiber_g"
    }
}

struct RecipeDetailResponse: Codable {
    let recipe: RecipeDetail
    let ingredients: [RecipeIngredient]
    let steps: [RecipeStep]
}

struct RecipeDetail: Codable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let tags: [String]?
    let prepTimeMin: Int?
    let cookTimeMin: Int?
    let servings: Int?
    let nutritionPerServing: NutritionInfo?

    enum CodingKeys: String, CodingKey {
        case id, name, description, tags, servings
        case prepTimeMin = "prep_time_min"
        case cookTimeMin = "cook_time_min"
        case nutritionPerServing = "nutrition_per_serving"
    }
}

struct RecipeIngredient: Codable, Identifiable {
    let id: String
    let name: String
    let amount: Double?
    let unit: String?
    let ingredientGroup: String?
    let sortOrder: Int?

    enum CodingKeys: String, CodingKey {
        case id, name, amount, unit
        case ingredientGroup = "ingredient_group"
        case sortOrder = "sort_order"
    }
}

struct RecipeStep: Codable, Identifiable {
    let id: String
    let stepNumber: Int
    let instruction: String
    let durationMin: Int?

    enum CodingKeys: String, CodingKey {
        case id, instruction
        case stepNumber = "step_number"
        case durationMin = "duration_min"
    }
}

// MARK: - Oda

struct OdaSyncRequest: Codable {
    let itemIds: [String]?
}

struct OdaSyncResponse: Codable {
    let ok: Bool
    let summary: OdaSyncSummary
    let results: [OdaSyncResult]
}

struct OdaSyncSummary: Codable {
    let total: Int
    let added: Int
    let notFound: Int
    let errors: Int
}

struct OdaSyncResult: Codable, Identifiable {
    var id: String { itemId }
    let itemId: String
    let name: String
    let status: String
    let odaProduct: OdaMatchedProduct?
    let error: String?
}

struct OdaMatchedProduct: Codable {
    let id: Int
    let name: String
    let price: String
}

struct OdaCart: Codable {
    let itemCount: Int
    let totalPrice: String
    let items: [OdaCartItem]
}

struct OdaCartItem: Codable, Identifiable {
    var id: Int { productId }
    let productId: Int
    let name: String
    let quantity: Int
    let price: String
}

// MARK: - Voice

struct VoiceRequest: Codable {
    let text: String
}

struct VoiceResponse: Codable {
    let reply: String
    let action: String?
}

// MARK: - Proactive

struct ProactiveResponse: Codable {
    let message: String?
}

// MARK: - Settings

struct HubSettings: Codable {
    var dinnerTime: String
    var proactiveEnabled: Bool
    var proactiveVoice: Bool
    var householdName: String
    var householdSize: Int
    var country: String
    var dayTypes: [String: String]?      // {1:"rask",3:"fisk",5:"koselig"}
    var staples: [String]?               // ["pasta","ris","løk",...]
    var fishTarget: Int?                 // weekly fish target (default 2)
    var veggieTarget: Int?               // weekly veggie target (default 1)
    var maxCookingTime: Int?             // max minutes (default 45)
    var traditions: [String: String]?    // {5:"Taco"}

    enum CodingKeys: String, CodingKey {
        case dinnerTime = "dinner_time"
        case proactiveEnabled = "proactive_enabled"
        case proactiveVoice = "proactive_voice"
        case householdName = "household_name"
        case householdSize = "household_size"
        case country
        case dayTypes = "day_types"
        case staples
        case fishTarget = "fish_target"
        case veggieTarget = "veggie_target"
        case maxCookingTime = "max_cooking_time"
        case traditions
    }
}

struct UpdateSettingsRequest: Codable {
    var dinnerTime: String?
    var proactiveEnabled: Bool?
    var proactiveVoice: Bool?
    var householdName: String?
    var householdSize: Int?
    var country: String?
    var dayTypes: [String: String]?
    var staples: [String]?
    var fishTarget: Int?
    var veggieTarget: Int?
    var maxCookingTime: Int?
    var traditions: [String: String]?

    enum CodingKeys: String, CodingKey {
        case dinnerTime = "dinner_time"
        case proactiveEnabled = "proactive_enabled"
        case proactiveVoice = "proactive_voice"
        case householdName = "household_name"
        case householdSize = "household_size"
        case country
        case dayTypes = "day_types"
        case staples
        case fishTarget = "fish_target"
        case veggieTarget = "veggie_target"
        case maxCookingTime = "max_cooking_time"
        case traditions
    }
}

// MARK: - Analytics

struct AnalyticsSummary: Codable {
    let features: [FeatureUsage]
}

struct FeatureUsage: Codable, Identifiable {
    var id: String { feature }
    let feature: String
    let total: Int
    let lastUsed: String
    let byDay: [String: Int]
    let actions: [String: Int]
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

/// Format ISO date "2026-03-24" → "24. mars"
func formatDayDate(_ isoDate: String?) -> String? {
    guard let iso = isoDate else { return nil }
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = TimeZone(identifier: "Europe/Oslo")
    guard let date = formatter.date(from: iso) else { return nil }
    let display = DateFormatter()
    display.locale = Locale(identifier: "nb_NO")
    display.dateFormat = "d. MMMM"
    display.timeZone = TimeZone(identifier: "Europe/Oslo")
    return display.string(from: date)
}

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
