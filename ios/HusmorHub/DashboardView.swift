import SwiftUI

struct DashboardView: View {
    @ObservedObject var api: APIClient

    @State private var weather: WeatherResponse?
    @State private var transport: TransportResponse?
    @State private var meals: MealsResponse?
    @State private var shopping: ShoppingResponse?
    @State private var calendar: CalendarResponse?
    @State private var reminders: RemindersResponse?
    @State private var childProfiles: ChildProfilesResponse?
    @State private var currentTime = ""
    @State private var voiceReply: String?
    @StateObject private var speech = SpeechRecognizer()

    private let weatherTimer = Timer.publish(every: 600, on: .main, in: .common).autoconnect()
    private let transportTimer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()
    private let mealsTimer = Timer.publish(every: 300, on: .main, in: .common).autoconnect()
    private let shoppingTimer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()
    private let calendarTimer = Timer.publish(every: 300, on: .main, in: .common).autoconnect()
    private let clockTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    // Next departure per direction
    private var nextMetroDepartures: [Departure] {
        let metro = transport?.departures.filter { $0.transportMode == "metro" } ?? []
        var seen = Set<String>()
        var result: [Departure] = []
        for dep in metro {
            if seen.insert(dep.destination).inserted {
                result.append(dep)
            }
            if result.count >= 2 { break }
        }
        return result
    }

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header: clock + transport
                header
                    .padding(.horizontal, 10)

                // Main content
                HStack(spacing: 8) {
                    // LEFT: Meal plan (hero) + child profiles
                    VStack(spacing: 8) {
                        MealPlanCard(
                            meals: meals,
                            shopping: shopping,
                            onToggleItem: toggleItem,
                            onAddItem: addItem,
                            onRateMeal: rateMeal
                        )
                        .frame(maxHeight: .infinity)

                        ChildProfilesCard(profiles: childProfiles)
                    }
                    .frame(maxWidth: .infinity)

                    // RIGHT: sidebar — weather, calendar, reminders
                    VStack(spacing: 8) {
                        // Weather compact
                        WeatherCard(weather: weather)

                        // Today: calendar + reminders
                        TodayCard(
                            calendar: calendar,
                            reminders: reminders,
                            onAddReminder: addReminder,
                            onDeleteReminder: deleteReminder
                        )
                        .frame(maxHeight: .infinity)
                    }
                    .frame(width: 340)
                }
                .padding(.horizontal, 10)
                .padding(.bottom, 8)
                .padding(.top, 2)
            }
        }
        .overlay {
            VoiceOverlay(
                speech: speech,
                voiceReply: $voiceReply
            )
        }
        .preferredColorScheme(.dark)
        .task {
            speech.requestPermission()
            speech.onAutoComplete = { text in sendVoice(text) }
            updateClock()
            await loadAll()
            // Start always-on "Hei Husmor" wake word listening
            speech.startWakeListening()
        }
        .onReceive(clockTimer) { _ in updateClock() }
        .onReceive(weatherTimer) { _ in Task { await loadWeather() } }
        .onReceive(transportTimer) { _ in Task { await loadTransport() } }
        .onReceive(mealsTimer) { _ in Task { await loadMeals() } }
        .onReceive(shoppingTimer) { _ in Task { await loadShopping() } }
        .onReceive(calendarTimer) { _ in Task { await loadCalendar() } }
    }

    private var header: some View {
        ZStack {
            // Centered clock
            Text(currentTime)
                .font(.system(size: 36, weight: .light, design: .rounded))
                .foregroundColor(Theme.text)

            HStack {
                // Left: brand + mic button
                Text("HUSMOR HUB")
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .foregroundColor(Theme.muted.opacity(0.3))
                    .tracking(3)

                Button(action: toggleVoice) {
                    HStack(spacing: 6) {
                        ZStack {
                            Circle()
                                .fill(speech.isListening ? Theme.red : (speech.isWakeListening ? Theme.green.opacity(0.15) : Theme.accent.opacity(0.2)))
                                .frame(width: 36, height: 36)

                            Image(systemName: speech.isListening ? "stop.fill" : "mic.fill")
                                .font(.system(size: 16))
                                .foregroundColor(speech.isListening ? .white : (speech.isWakeListening ? Theme.green : Theme.accent))
                        }
                        if speech.isWakeListening && !speech.isListening {
                            Text("\"Hei Husmor\"")
                                .font(.system(size: 10))
                                .foregroundColor(Theme.muted.opacity(0.4))
                        }
                    }
                }
                .buttonStyle(.plain)
                .contentShape(Rectangle().size(width: 140, height: 44))

                Spacer()

                // Right: T-bane departures
                transportStrip
            }
        }
        .frame(height: 40)
    }

    private func toggleVoice() {
        if speech.isListening {
            speech.stopAndSend()
        } else {
            voiceReply = nil
            speech.startActive()
        }
    }

    private var transportStrip: some View {
        HStack(spacing: 16) {
            ForEach(Array(nextMetroDepartures.enumerated()), id: \.offset) { _, dep in
                HStack(spacing: 6) {
                    Text(dep.line)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 20, height: 20)
                        .background(Theme.lineColor(for: dep.line, mode: "metro"))
                        .cornerRadius(5)
                    Text(dep.destination)
                        .font(.system(size: 13))
                        .foregroundColor(Theme.muted)
                        .lineLimit(1)
                    Text(dep.minutesUntil <= 0 ? "nå" : "\(dep.minutesUntil) min")
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundColor(dep.minutesUntil <= 2 ? Theme.yellow : Theme.text)
                }
            }
        }
    }

    // MARK: - Data loading

    private func loadAll() async {
        async let w: () = loadWeather()
        async let t: () = loadTransport()
        async let m: () = loadMeals()
        async let s: () = loadShopping()
        async let c: () = loadCalendar()
        async let r: () = loadReminders()
        async let cp: () = loadChildProfiles()
        _ = await (w, t, m, s, c, r, cp)
    }

    private func loadWeather() async {
        do { weather = try await api.fetchWeather() } catch { /* silent */ }
    }

    private func loadTransport() async {
        do { transport = try await api.fetchTransport() } catch { /* silent */ }
    }

    private func loadMeals() async {
        do { meals = try await api.fetchMeals() } catch { /* silent */ }
    }

    private func loadShopping() async {
        do { shopping = try await api.fetchShopping() } catch { /* silent */ }
    }

    private func loadCalendar() async {
        do { calendar = try await api.fetchCalendar() } catch { /* silent */ }
    }

    private func loadReminders() async {
        do { reminders = try await api.fetchReminders() } catch { /* silent */ }
    }

    private func toggleItem(_ id: String, _ checked: Bool) {
        if let idx = shopping?.items.firstIndex(where: { $0.id == id }) {
            shopping?.items[idx].checked = checked
        }
        Task {
            do {
                try await api.toggleItem(id: id, checked: checked)
            } catch {
                if let idx = shopping?.items.firstIndex(where: { $0.id == id }) {
                    shopping?.items[idx].checked = !checked
                }
            }
        }
    }

    private func loadChildProfiles() async {
        do { childProfiles = try await api.fetchChildProfiles() } catch { /* silent */ }
    }

    private func sendVoice(_ text: String) {
        Task {
            do {
                let response = try await api.sendVoice(text: text)
                voiceReply = response.reply
                // Reload relevant data after voice actions
                if response.action == "add_shopping_items" {
                    await loadShopping()
                } else if response.action == "rate_meal" {
                    await loadMeals()
                } else if response.action == "log_child_reaction" {
                    await loadChildProfiles()
                }
            } catch {
                voiceReply = "Feil: \(error.localizedDescription)"
            }
        }
    }

    private func rateMeal(_ dayOfWeek: Int, _ emoji: String) {
        Task {
            try? await api.rateMeal(dayOfWeek: dayOfWeek, feedbackEmoji: emoji)
        }
    }

    private func addItem(_ name: String) {
        Task {
            try? await api.addItems(names: [name])
            await loadShopping()
        }
    }

    private func addReminder(_ title: String, _ emoji: String) {
        Task {
            try? await api.createReminder(title: title, emoji: emoji)
            await loadReminders()
        }
    }

    private func deleteReminder(_ id: String) {
        reminders?.reminders.removeAll(where: { $0.id == id })
        Task {
            try? await api.deleteReminder(id: id)
            await loadReminders()
        }
    }

    private func updateClock() {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        currentTime = formatter.string(from: Date())
    }
}

// MARK: - Voice Overlay
// Only shows centered transcript/reply. Passes touches through to content below.

struct VoiceOverlay: View {
    @ObservedObject var speech: SpeechRecognizer
    @Binding var voiceReply: String?

    private var isShowingContent: Bool {
        speech.isListening || voiceReply != nil
    }

    var body: some View {
        ZStack {
            // Dim background when voice is active
            if isShowingContent {
                Theme.background.opacity(0.6)
                    .ignoresSafeArea()
                    .onTapGesture {
                        if speech.isListening {
                            speech.stopAndSend()
                        }
                        withAnimation { voiceReply = nil }
                    }
            }

            // Centered content
            if speech.isListening {
                VStack(spacing: 16) {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 28))
                        .foregroundColor(Theme.red)
                        .symbolEffect(.pulse, isActive: true)

                    if !speech.transcript.isEmpty {
                        Text(speech.transcript)
                            .font(.system(size: 28, weight: .medium))
                            .foregroundColor(Theme.text)
                            .multilineTextAlignment(.center)
                            .padding(24)
                            .frame(maxWidth: 600)
                            .background(Theme.card.opacity(0.95))
                            .cornerRadius(20)
                    } else {
                        Text("Snakk nå...")
                            .font(.system(size: 22, weight: .medium))
                            .foregroundColor(Theme.muted)
                    }
                }
                .transition(.opacity)
            } else if let reply = voiceReply {
                Text(reply)
                    .font(.system(size: 24, weight: .medium))
                    .foregroundColor(Theme.text)
                    .multilineTextAlignment(.center)
                    .padding(24)
                    .frame(maxWidth: 500)
                    .background(Theme.card.opacity(0.95))
                    .cornerRadius(20)
                    .transition(.opacity)
                    .onTapGesture { withAnimation { voiceReply = nil } }
                    .onAppear {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                            withAnimation { voiceReply = nil }
                        }
                    }
            }
        }
        .allowsHitTesting(isShowingContent)
        .animation(.easeInOut(duration: 0.25), value: speech.isListening)
        .animation(.easeInOut(duration: 0.3), value: voiceReply != nil)
    }
}

// MARK: - Card Container

struct CardContainer<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(Theme.text)

            content
        }
        .padding(Theme.cardPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.card)
        .cornerRadius(Theme.cardCorner)
    }
}
