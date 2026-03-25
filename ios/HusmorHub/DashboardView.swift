import SwiftUI

struct DashboardView: View {
    @ObservedObject var api: APIClient

    @State private var weather: WeatherResponse?
    @State private var transport: TransportResponse?
    @State private var meals: MealsResponse?
    @State private var shopping: ShoppingResponse?
    @State private var calendar: CalendarResponse?
    @State private var reminders: RemindersResponse?
    @State private var currentTime = ""
    @State private var currentDate = ""
    @State private var voiceReply: String?
    @State private var showMealGenerator = false
    @State private var showRecipes = false
    @State private var odaCart: OdaCart?
    @State private var isSyncingOda = false
    @State private var proactiveMessage: String?
    @State private var errorToast: String?
    @State private var isOffline = false
    @State private var showSettings = false
    @State private var proactiveVoice = true
    @State private var dinnerTime = "17:00"
    @StateObject private var speech = SpeechRecognizer()
    @StateObject private var speaker = HusmorSpeaker()

    private let weatherTimer = Timer.publish(every: 600, on: .main, in: .common).autoconnect()
    private let transportTimer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()
    private let mealsTimer = Timer.publish(every: 300, on: .main, in: .common).autoconnect()
    private let shoppingTimer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()
    private let calendarTimer = Timer.publish(every: 300, on: .main, in: .common).autoconnect()
    private let clockTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    private let proactiveTimer = Timer.publish(every: 900, on: .main, in: .common).autoconnect()

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

    // MARK: - Body

    var body: some View {
        mainLayout
            .overlay(alignment: .top) { offlineOverlay }
            .animation(.easeInOut(duration: 0.3), value: isOffline)
            .overlay(alignment: .bottom) { toastOverlay }
            .overlay { VoiceOverlay(speech: speech, speaker: speaker, voiceReply: $voiceReply) }
            .fullScreenCover(isPresented: $showMealGenerator) { mealGeneratorSheet }
            .sheet(isPresented: $showRecipes) { recipesSheet }
            .fullScreenCover(isPresented: $showSettings) { settingsSheet }
            .preferredColorScheme(.dark)
            .task { await onAppear() }
            .onReceive(clockTimer) { _ in updateClock() }
            .onReceive(weatherTimer) { _ in Task { await loadWeather() } }
            .onReceive(transportTimer) { _ in Task { await loadTransport() } }
            .onReceive(mealsTimer) { _ in Task { await loadMeals() } }
            .onReceive(shoppingTimer) { _ in Task { await loadShopping() } }
            .onReceive(calendarTimer) { _ in Task { await loadCalendar() } }
            .onReceive(proactiveTimer) { _ in Task { await checkProactive() } }
    }

    // MARK: - Layout

    private var mainLayout: some View {
        GeometryReader { geo in
            ZStack {
                Theme.background.ignoresSafeArea()

                VStack(spacing: 0) {
                    statusBar(geo: geo)
                    twoColumns(geo: geo)
                }
            }
            .ignoresSafeArea(edges: .bottom)
        }
    }

    // MARK: - Status bar (unified surface)

    private func statusBar(geo: GeometryProxy) -> some View {
        HStack(spacing: 0) {
            // LEFT: Weather module + voice
            HStack(spacing: 0) {
                weatherModule
                    .padding(.trailing, 20)
                micButton
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // CENTER: Clock + date (visual anchor)
            VStack(spacing: 1) {
                Text(currentTime)
                    .font(.system(size: 32, weight: .ultraLight, design: .rounded))
                    .foregroundColor(Theme.text)
                Text(currentDate)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(Theme.muted)
            }

            // RIGHT: Transport + settings
            HStack(spacing: 0) {
                transportModule
                    .padding(.trailing, 12)

                Button(action: { showSettings = true }) {
                    Image(systemName: "gearshape")
                        .font(.system(size: 11))
                        .foregroundColor(Theme.muted)
                        .frame(width: 28, height: 28)
                        .glassButton(shape: RoundedRectangle(cornerRadius: 7))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 16)
        .frame(height: 56)
        .glassBar()
    }

    private var micButton: some View {
        Button(action: toggleVoice) {
            HStack(spacing: 5) {
                ZStack {
                    Image(systemName: speech.isListening ? "stop.fill" : "mic.fill")
                        .font(.system(size: 11))
                        .foregroundColor(speech.isListening ? .white : (speech.isWakeListening ? Theme.green : Theme.muted))
                        .frame(width: 28, height: 28)
                        .glassEffect(
                            speech.isListening ? .regular.tint(Theme.red).interactive() : .regular,
                            in: Circle()
                        )
                }
                if speech.isWakeListening && !speech.isListening {
                    Text("Stemme")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(Theme.muted)
                }
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Weather module (left)

    private var weatherModule: some View {
        Group {
            if let w = weather {
                let nextChange = findNextWeatherChange(w)

                HStack(spacing: 10) {
                    HStack(spacing: 5) {
                        Image(systemName: w.current.symbolCode.weatherSFSymbol)
                            .symbolRenderingMode(.multicolor)
                            .font(.system(size: 18))
                        Text("\(Int(round(w.current.temperature)))°")
                            .font(.system(size: 17, weight: .semibold, design: .rounded))
                            .foregroundColor(Theme.text)
                    }

                    if let next = nextChange {
                        Rectangle()
                            .fill(Theme.muted.opacity(0.12))
                            .frame(width: 1, height: 18)

                        HStack(spacing: 4) {
                            Text(next.label)
                                .font(.system(size: 10))
                                .foregroundColor(Theme.muted)
                            Image(systemName: next.icon)
                                .symbolRenderingMode(.multicolor)
                                .font(.system(size: 13))
                            Text("\(next.temp)°")
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                                .foregroundColor(Theme.muted)
                        }
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Theme.surface.opacity(0.35))
                .cornerRadius(10)
            }
        }
    }

    // MARK: - Transport module (right)

    private var transportModule: some View {
        HStack(spacing: 12) {
            ForEach(Array(nextMetroDepartures.enumerated()), id: \.offset) { _, dep in
                HStack(spacing: 5) {
                    Text(dep.line)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 18, height: 18)
                        .background(Theme.lineColor(for: dep.line, mode: "metro"))
                        .cornerRadius(4)
                    Text(dep.destination)
                        .font(.system(size: 11))
                        .foregroundColor(Theme.muted)
                        .lineLimit(1)
                    Text(dep.minutesUntil <= 0 ? "nå" : "\(dep.minutesUntil) min")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundColor(dep.minutesUntil <= 2 ? Theme.yellow : Theme.text)
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Theme.surface.opacity(0.35))
        .cornerRadius(10)
    }

    // MARK: - Two-column layout

    private func twoColumns(geo: GeometryProxy) -> some View {
        let rightWidth = min(300, geo.size.width * 0.30)

        return HStack(spacing: 8) {
            mealColumn
            rightColumn(width: rightWidth)
        }
        .padding(.horizontal, 10)
        .padding(.top, 2)
        .padding(.bottom, 4)
    }

    private var mealColumn: some View {
        MealPlanCard(
            meals: meals,
            shopping: shopping,
            dinnerTime: dinnerTime,
            onShowGenerator: { showMealGenerator = true },
            onShowRecipes: { showRecipes = true }
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func rightColumn(width: CGFloat) -> some View {
        VStack(spacing: 0) {
            ShoppingCard(
                meals: meals,
                shopping: shopping,
                odaCart: odaCart,
                onToggleItem: toggleItem,
                onAddItem: addItem,
                onDeleteChecked: deleteCheckedItems,
                onSyncOda: syncOda,
                onRemoveOdaItem: removeOdaItem,
                isSyncingOda: isSyncingOda
            )
            .frame(maxHeight: .infinity)

            Rectangle()
                .fill(Theme.muted.opacity(0.08))
                .frame(height: 1)
                .padding(.horizontal, 10)

            TodayCard(
                calendar: calendar,
                reminders: reminders,
                onAddReminder: addReminder,
                onDeleteReminder: deleteReminder
            )
            .frame(minHeight: 140)
        }
        .frame(width: width)
        .glassCard()
    }

    // MARK: - Overlays

    @ViewBuilder
    private var offlineOverlay: some View {
        if isOffline {
            HStack(spacing: 8) {
                Image(systemName: "wifi.slash").font(.system(size: 12))
                Text("Ingen kontakt med serveren").font(.system(size: 13, weight: .medium))
            }
            .foregroundColor(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .glassEffect(.regular.tint(Theme.red), in: Capsule())
            .padding(.top, 4)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    private var toastOverlay: some View {
        VStack(spacing: 10) {
            if let toast = errorToast {
                ErrorToast(message: toast) { withAnimation { errorToast = nil } }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if let msg = proactiveMessage {
                ProactiveBanner(message: msg) {
                    withAnimation { proactiveMessage = nil }
                    speaker.stop()
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.bottom, 20)
        .padding(.horizontal, 20)
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: errorToast)
        .animation(.spring(response: 0.5, dampingFraction: 0.8), value: proactiveMessage)
    }

    // MARK: - Sheets

    private var mealGeneratorSheet: some View {
        MealGeneratorView(api: api, dashboardSpeech: speech) {
            showMealGenerator = false
        }
        .onAppear { UsageTracker.shared.view("meal_generator") }
        .onDisappear { Task { await loadMeals() } }
    }

    private var recipesSheet: some View {
        RecipeListView(api: api)
            .presentationDetents([.large])
            .onAppear { UsageTracker.shared.view("recipes") }
    }

    private var settingsSheet: some View {
        SettingsView(api: api)
            .onDisappear { Task { await loadSettings() } }
    }

    private func onAppear() async {
        UsageTracker.shared.start()
        UsageTracker.shared.view("dashboard")
        speech.requestPermission()
        speech.onAutoComplete = { text in sendVoice(text) }
        updateClock()
        await loadAll()
        await loadSettings()
        speech.startWakeListening()
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
            Task { await checkProactive() }
        }
    }

    // MARK: - Weather helpers

    private struct WeatherChange {
        let label: String
        let icon: String
        let temp: Int
    }

    private func findNextWeatherChange(_ w: WeatherResponse) -> WeatherChange? {
        let now = Date()
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fallback = ISO8601DateFormatter()
        fallback.formatOptions = [.withInternetDateTime]

        let upcoming = w.hourly.filter { hour in
            if let d = formatter.date(from: hour.time) ?? fallback.date(from: hour.time) {
                return d > now
            }
            return false
        }.prefix(12)

        let currentCategory = weatherCategory(w.current.symbolCode)

        for hour in upcoming {
            let cat = weatherCategory(hour.symbolCode)
            let bigTempShift = abs(hour.temperature - w.current.temperature) > 4

            if cat != currentCategory || bigTempShift {
                let label = "kl \(hourString(from: hour.time))"
                return WeatherChange(label: label, icon: hour.symbolCode.weatherSFSymbol, temp: Int(round(hour.temperature)))
            }
        }

        let arr = Array(upcoming)
        guard !arr.isEmpty else { return nil }
        let mid = arr[arr.count / 2]
        return WeatherChange(label: "kl \(hourString(from: mid.time))", icon: mid.symbolCode.weatherSFSymbol, temp: Int(round(mid.temperature)))
    }

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

    // MARK: - Actions

    private func toggleVoice() {
        UsageTracker.shared.tap("voice")
        if speech.isListening {
            speech.stopAndSend()
        } else {
            voiceReply = nil
            speech.startActive()
        }
    }

    private func showError(_ message: String) {
        withAnimation { errorToast = message }
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            withAnimation { errorToast = nil }
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
        async let o: () = loadOdaCart()
        _ = await (w, t, m, s, c, r, o)

        let allFailed = weather == nil && meals == nil && shopping == nil && calendar == nil
        withAnimation { isOffline = allFailed }
    }

    private func loadWeather() async {
        do {
            weather = try await api.fetchWeather()
            if isOffline { withAnimation { isOffline = false } }
        } catch { /* silent */ }
    }

    private func loadTransport() async {
        do {
            transport = try await api.fetchTransport()
            if isOffline { withAnimation { isOffline = false } }
        } catch { /* silent */ }
    }

    private func loadMeals() async {
        do {
            meals = try await api.fetchMeals()
            if isOffline { withAnimation { isOffline = false } }
        } catch { /* silent */ }
    }

    private func loadShopping() async {
        do {
            shopping = try await api.fetchShopping()
            if isOffline { withAnimation { isOffline = false } }
        } catch { /* silent */ }
    }

    private func loadCalendar() async {
        do { calendar = try await api.fetchCalendar() } catch { /* silent */ }
    }

    private func loadReminders() async {
        do { reminders = try await api.fetchReminders() } catch { /* silent */ }
    }

    private func loadSettings() async {
        do {
            let s = try await api.fetchSettings()
            proactiveVoice = s.proactiveVoice
            dinnerTime = s.dinnerTime
        } catch { /* silent */ }
    }

    private func toggleItem(_ id: String, _ checked: Bool) {
        UsageTracker.shared.tap("shopping_toggle")
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
                showError("Kunne ikke oppdatere vare")
            }
        }
    }

    private func deleteCheckedItems() {
        UsageTracker.shared.tap("shopping_delete_checked")
        let removed = shopping?.items.filter { $0.checked } ?? []
        shopping?.items.removeAll { $0.checked }
        Task {
            do {
                try await api.deleteCheckedItems()
            } catch {
                shopping?.items.append(contentsOf: removed)
                showError("Kunne ikke fjerne handlede varer")
            }
        }
    }

    private func loadOdaCart() async {
        do { odaCart = try await api.fetchOdaCart() } catch { /* silent */ }
    }

    private func checkProactive() async {
        do {
            let resp = try await api.fetchProactive()
            if let msg = resp.message, !msg.isEmpty {
                UsageTracker.shared.view("proactive_message")
                withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                    proactiveMessage = msg
                }
                if proactiveVoice {
                    speaker.speak(msg)
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 12) {
                    withAnimation { proactiveMessage = nil }
                }
            }
        } catch { /* silent */ }
    }

    private func syncOda(_ itemIds: [String]?) {
        UsageTracker.shared.tap("oda_sync")
        isSyncingOda = true
        Task {
            do {
                let _ = try await api.syncOda(itemIds: itemIds)
                await loadOdaCart()
            } catch {
                showError("Oda-sync feilet")
            }
            isSyncingOda = false
        }
    }

    private func removeOdaItem(_ productId: Int) {
        UsageTracker.shared.tap("oda_remove")
        Task {
            do {
                try await api.removeOdaItem(productId: productId)
                await loadOdaCart()
            } catch {
                showError("Kunne ikke fjerne fra Oda")
            }
        }
    }

    private func sendVoice(_ text: String) {
        UsageTracker.shared.track("voice", action: "submit")
        Task {
            do {
                let response = try await api.sendVoice(text: text)
                voiceReply = response.reply
                if !response.reply.isEmpty {
                    speaker.speak(response.reply)
                }
                if response.action == "add_shopping_items" {
                    await loadShopping()
                } else if response.action == "rate_meal" {
                    await loadMeals()
                }
            } catch {
                voiceReply = "Beklager, noe gikk galt"
                speaker.speak("Beklager, noe gikk galt")
            }
        }
    }

    private func rateMeal(_ dayOfWeek: Int, _ emoji: String) {
        UsageTracker.shared.track("meal_rating", action: "tap", metadata: ["emoji": emoji])
        Task {
            do {
                try await api.rateMeal(dayOfWeek: dayOfWeek, feedbackEmoji: emoji)
            } catch {
                showError("Kunne ikke lagre vurdering")
            }
        }
    }

    private func addItem(_ name: String) {
        UsageTracker.shared.tap("shopping_add")
        Task {
            do {
                try await api.addItems(names: [name])
                await loadShopping()
            } catch {
                showError("Kunne ikke legge til \u{00AB}\(name)\u{00BB}")
            }
        }
    }

    private func addReminder(_ title: String, _ emoji: String) {
        UsageTracker.shared.tap("reminder_add")
        Task {
            do {
                try await api.createReminder(title: title, emoji: emoji)
                await loadReminders()
            } catch {
                showError("Kunne ikke opprette p\u{00E5}minnelse")
            }
        }
    }

    private func deleteReminder(_ id: String) {
        UsageTracker.shared.tap("reminder_delete")
        reminders?.reminders.removeAll(where: { $0.id == id })
        Task {
            do {
                try await api.deleteReminder(id: id)
                await loadReminders()
            } catch {
                await loadReminders()
                showError("Kunne ikke slette p\u{00E5}minnelse")
            }
        }
    }

    private func updateClock() {
        let now = Date()
        let timeFmt = DateFormatter()
        timeFmt.dateFormat = "HH:mm"
        currentTime = timeFmt.string(from: now)

        let dateFmt = DateFormatter()
        dateFmt.locale = Locale(identifier: "nb_NO")
        dateFmt.dateFormat = "EEEE d. MMMM"
        currentDate = dateFmt.string(from: now).capitalized
    }
}
