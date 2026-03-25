import Foundation

/// Lightweight usage tracker that batches events and flushes to the backend periodically.
/// Tracks which features are tapped/viewed so we can identify dead UI after a few weeks.
@MainActor
final class UsageTracker {
    static let shared = UsageTracker()

    private var buffer: [UsageEvent] = []
    private var flushTimer: Timer?
    private let flushInterval: TimeInterval = 120 // 2 minutes
    private let maxBufferSize = 50

    struct UsageEvent: Codable {
        let feature: String
        let action: String
        let metadata: [String: String]?
        let timestamp: Date

        var apiPayload: [String: Any] {
            var d: [String: Any] = ["feature": feature, "action": action]
            if let m = metadata { d["metadata"] = m }
            return d
        }
    }

    private init() {}

    func start() {
        flushTimer = Timer.scheduledTimer(withTimeInterval: flushInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.flush()
            }
        }
    }

    // MARK: - Track events

    func track(_ feature: String, action: String = "tap", metadata: [String: String]? = nil) {
        buffer.append(UsageEvent(feature: feature, action: action, metadata: metadata, timestamp: Date()))

        if buffer.count >= maxBufferSize {
            flush()
        }
    }

    // Convenience for common patterns
    func view(_ feature: String) { track(feature, action: "view") }
    func tap(_ feature: String) { track(feature, action: "tap") }

    // MARK: - Flush to backend

    func flush() {
        guard !buffer.isEmpty else { return }
        let events = buffer
        buffer.removeAll()

        // Build JSON payload
        let payload: [[String: Any]] = events.map { $0.apiPayload }
        let body: [String: Any] = ["events": payload]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: body),
              let token = APIClient.shared.token else {
            // No token — put events back
            buffer.insert(contentsOf: events, at: 0)
            return
        }

        var request = URLRequest(url: URL(string: "https://fyrk-agent-runtime.fly.dev/hub/api/analytics/events")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = jsonData

        // Fire-and-forget
        URLSession.shared.dataTask(with: request) { _, response, _ in
            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                // Put events back on failure — they'll retry next flush
                Task { @MainActor in
                    UsageTracker.shared.buffer.insert(contentsOf: events, at: 0)
                }
            }
        }.resume()
    }
}
