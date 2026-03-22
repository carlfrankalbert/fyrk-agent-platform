import Foundation

@MainActor
class APIClient: ObservableObject {
    static let shared = APIClient()

    private let baseURL = "https://fyrk-agent-runtime.fly.dev/hub/api"
    private let session = URLSession.shared

    @Published var token: String? {
        didSet {
            UserDefaults.standard.set(token, forKey: "hub_token")
        }
    }
    @Published var isAuthenticated = false

    init() {
        self.token = UserDefaults.standard.string(forKey: "hub_token")
    }

    // MARK: - Auth

    func checkAuth() async {
        guard let token = token, !token.isEmpty else {
            isAuthenticated = false
            return
        }
        do {
            let _: AuthMeResponse = try await get("/auth/me")
            isAuthenticated = true
        } catch {
            isAuthenticated = false
            self.token = nil
        }
    }

    func verifyCode(code: String) async throws {
        let body = VerifyCodeRequest(code: code)
        let resp: VerifyResponse = try await postJSON("/auth/verify", body: body)
        self.token = resp.token
        self.isAuthenticated = true
    }

    func logout() {
        token = nil
        isAuthenticated = false
    }

    // MARK: - Data

    func fetchWeather() async throws -> WeatherResponse {
        try await get("/weather")
    }

    func fetchTransport() async throws -> TransportResponse {
        try await get("/transport")
    }

    func fetchMeals() async throws -> MealsResponse {
        try await get("/meals/week")
    }

    func fetchShopping() async throws -> ShoppingResponse {
        try await get("/shopping")
    }

    func fetchCalendar() async throws -> CalendarResponse {
        try await get("/calendar")
    }

    func fetchReminders() async throws -> RemindersResponse {
        try await get("/reminders")
    }

    func createReminder(title: String, emoji: String) async throws {
        let body = CreateReminderRequest(title: title, emoji: emoji, recurrence: "daily")
        try await post("/reminders", body: body)
    }

    func deleteReminder(id: String) async throws {
        try await delete("/reminders/\(id)")
    }

    func toggleItem(id: String, checked: Bool) async throws {
        let body = CheckedUpdate(checked: checked)
        try await patch("/shopping/items/\(id)", body: body)
    }

    func addItems(names: [String]) async throws {
        let body = AddItemsRequest(items: names.map { NewItem(name: $0) })
        try await post("/shopping/items", body: body)
    }

    func rateMeal(dayOfWeek: Int, feedbackEmoji: String) async throws {
        let body = RateMealRequest(dayOfWeek: dayOfWeek, feedbackEmoji: feedbackEmoji)
        try await post("/meals/rate", body: body)
    }

    func fetchChildProfiles() async throws -> ChildProfilesResponse {
        try await get("/children/profiles")
    }

    func sendVoice(text: String) async throws -> VoiceResponse {
        let body = VoiceRequest(text: text)
        return try await postJSON("/voice", body: body)
    }

    // MARK: - HTTP helpers

    private func get<T: Decodable>(_ path: String) async throws -> T {
        var request = URLRequest(url: URL(string: baseURL + path)!)
        request.httpMethod = "GET"
        addAuth(&request)
        let (data, response) = try await session.data(for: request)
        try checkResponse(response)
        return try JSONDecoder().decode(T.self, from: data)
    }

    @discardableResult
    private func post(_ path: String, body: some Encodable) async throws -> Data {
        var request = URLRequest(url: URL(string: baseURL + path)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuth(&request)
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        try checkResponse(response)
        return data
    }

    private func postJSON<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        var request = URLRequest(url: URL(string: baseURL + path)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuth(&request)
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        try checkResponse(response)
        return try JSONDecoder().decode(T.self, from: data)
    }

    @discardableResult
    private func delete(_ path: String) async throws -> Data {
        var request = URLRequest(url: URL(string: baseURL + path)!)
        request.httpMethod = "DELETE"
        addAuth(&request)
        let (data, response) = try await session.data(for: request)
        try checkResponse(response)
        return data
    }

    @discardableResult
    private func patch(_ path: String, body: some Encodable) async throws -> Data {
        var request = URLRequest(url: URL(string: baseURL + path)!)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        addAuth(&request)
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        try checkResponse(response)
        return data
    }

    private func addAuth(_ request: inout URLRequest) {
        if let token = token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }

    private func checkResponse(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            Task { @MainActor in
                self.isAuthenticated = false
                self.token = nil
            }
            throw APIError.unauthorized
        }
        guard (200...299).contains(http.statusCode) else {
            throw APIError.httpError(http.statusCode)
        }
    }
}

enum APIError: Error, LocalizedError {
    case invalidResponse
    case unauthorized
    case httpError(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Ugyldig svar fra server"
        case .unauthorized: return "Ikke autorisert"
        case .httpError(let code): return "Serverfeil (\(code))"
        }
    }
}
