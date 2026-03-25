import SwiftUI

enum GeneratorStep {
    case chat
    case setup
    case loading
    case result
}

struct ChatBubble: Identifiable {
    let id = UUID()
    let role: String
    let text: String
}

struct MealGeneratorView: View {
    @ObservedObject var api: APIClient
    var dashboardSpeech: SpeechRecognizer?
    let onDone: () -> Void

    @State private var step: GeneratorStep = .chat
    @State private var planNextWeek = false // activated when user taps a past day
    @State private var dayModes: [Int: DayMode] = {
        var modes: [Int: DayMode] = [:]
        for d in 1...7 { modes[d] = .generate }
        return modes
    }()
    @State private var editingDay: Int? = nil
    @State private var editText: String = ""
    @State private var showCuisinePicker: Int? = nil
    @State private var cuisineSearch: String = ""
    @State private var days: [GeneratedDay] = []
    @State private var selectedOption: [Int: Int] = [:]
    @State private var revealedDays: Set<Int> = []
    @State private var isSaving = false
    @State private var reply: String?
    @State private var error: String?
    @State private var lockedDays: Set<Int> = []
    @State private var mealSources: [Int: MealSource] = [:]
    @State private var showActionDay: Int? = nil
    @State private var manualMealText: String = ""

    // Chat state
    @State private var chatMessages: [MealsChatMessage] = []
    @State private var chatBubbles: [ChatBubble] = []
    @State private var chatInput: String = ""
    @State private var isChatLoading = false
    @State private var kitchenContext: String?
    @State private var extractedIngredients: [String] = []
    @State private var extractedPreferences: [String] = []
    @State private var extractedNeedToBuy: [String] = []
    @StateObject private var chatSpeech = SpeechRecognizer()
    @StateObject private var chatSpeaker = HusmorSpeaker()

    private let dayNames = ["", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lordag", "Sondag"]
    private let dayNamesShort = ["", "Man", "Tir", "Ons", "Tor", "Fre", "Lor", "Son"]

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            switch step {
            case .chat:
                chatView
            case .setup:
                setupView
            case .loading:
                loadingView
            case .result:
                if let error = error {
                    errorView(error)
                } else {
                    planView
                }
            }
        }
        .task {
            // Stop dashboard wake listener so it doesn't fight for audio
            dashboardSpeech?.stopListening()
            // Don't auto-restart into wake mode after commands
            chatSpeech.autoWakeRestart = false
            chatSpeech.requestPermission()
            chatSpeech.onAutoComplete = { text in
                chatInput = text
                sendChatMessage()
            }
        }
        .onDisappear {
            chatSpeech.stopListening()
            // Restart dashboard wake listener
            dashboardSpeech?.startWakeListening()
        }
    }

    // MARK: - Chat step

    private var chatView: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Snakk med Husmor")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(Theme.text)
                Spacer()
                Button("Hopp over") {
                    withAnimation { step = .setup }
                }
                .font(.system(size: 14))
                .foregroundColor(Theme.muted)

                Button("Avbryt") { onDone() }
                    .font(.system(size: 14))
                    .foregroundColor(Theme.muted)
                    .padding(.leading, 8)
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 8)

            // Main content: conversation + sidebar
            HStack(spacing: 12) {
                // Left: conversation
                VStack(spacing: 0) {
                    if chatBubbles.isEmpty {
                        Spacer()
                        VStack(spacing: 12) {
                            Text("👩‍🍳")
                                .font(.system(size: 48))
                            Text("Fortell meg hva du har i kj\u{00F8}leskapet!")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(Theme.text)
                            Text("G\u{00E5} rundt p\u{00E5} kj\u{00F8}kkenet og fortell meg hva du ser.\nJeg hjelper deg planlegge uken.")
                                .font(.system(size: 13))
                                .foregroundColor(Theme.muted)
                                .multilineTextAlignment(.center)
                        }
                        Spacer()
                    } else {
                        ScrollViewReader { proxy in
                            ScrollView {
                                VStack(spacing: 8) {
                                    ForEach(chatBubbles) { bubble in
                                        chatBubbleView(bubble)
                                    }
                                    if isChatLoading {
                                        HStack {
                                            ProgressView()
                                                .scaleEffect(0.7)
                                                .tint(Theme.muted)
                                            Text("Husmor tenker...")
                                                .font(.system(size: 13))
                                                .foregroundColor(Theme.muted)
                                            Spacer()
                                        }
                                        .padding(.horizontal, 12)
                                        .id("loading")
                                    }
                                }
                                .padding(.vertical, 8)
                            }
                            .onChange(of: chatBubbles.count) {
                                withAnimation {
                                    proxy.scrollTo(chatBubbles.last?.id, anchor: .bottom)
                                }
                            }
                        }
                    }

                    // Input bar
                    HStack(spacing: 8) {
                        // Mic button
                        Button(action: toggleChatVoice) {
                            Image(systemName: chatSpeech.isListening ? "stop.fill" : "mic.fill")
                                .font(.system(size: 16))
                                .foregroundColor(chatSpeech.isListening ? .white : Theme.accent)
                                .frame(width: 36, height: 36)
                                .background(chatSpeech.isListening ? Theme.red : Theme.accent.opacity(0.15))
                                .cornerRadius(18)
                        }
                        .buttonStyle(.plain)

                        TextField("", text: $chatInput, prompt: Text("Jeg har agurk, tomater...").foregroundColor(Theme.muted))
                            .font(.system(size: 15))
                            .foregroundColor(Theme.text)
                            .textFieldStyle(.plain)
                            .onSubmit { sendChatMessage() }

                        if !chatInput.isEmpty {
                            Button(action: sendChatMessage) {
                                Image(systemName: "arrow.up.circle.fill")
                                    .font(.system(size: 28))
                                    .foregroundColor(Theme.accent)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)

                    // Live transcription
                    if chatSpeech.isListening && !chatSpeech.transcript.isEmpty {
                        Text(chatSpeech.transcript)
                            .font(.system(size: 14))
                            .foregroundColor(Theme.accent)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 4)
                    }
                }
                .frame(maxWidth: .infinity)

                // Right sidebar: extracted info + proceed button
                VStack(alignment: .leading, spacing: 12) {
                    if !extractedIngredients.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 4) {
                                Image(systemName: "refrigerator.fill")
                                    .font(.system(size: 11))
                                    .foregroundColor(Theme.accent)
                                Text("Tilgjengelig")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(Theme.text)
                            }
                            ForEach(extractedIngredients, id: \.self) { item in
                                HStack(spacing: 4) {
                                    Text("•")
                                        .foregroundColor(Theme.green)
                                    Text(item)
                                        .font(.system(size: 12))
                                        .foregroundColor(Theme.text)
                                }
                            }
                        }
                    }

                    if !extractedPreferences.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 4) {
                                Image(systemName: "heart.fill")
                                    .font(.system(size: 11))
                                    .foregroundColor(Theme.red)
                                Text("Ønsker")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(Theme.text)
                            }
                            ForEach(extractedPreferences, id: \.self) { pref in
                                HStack(spacing: 4) {
                                    Text("•")
                                        .foregroundColor(Theme.muted)
                                    Text(pref)
                                        .font(.system(size: 12))
                                        .foregroundColor(Theme.text)
                                }
                            }
                        }
                    }

                    if !extractedNeedToBuy.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 4) {
                                Image(systemName: "cart.fill")
                                    .font(.system(size: 11))
                                    .foregroundColor(Theme.yellow)
                                Text("Må kjøpes")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(Theme.text)
                            }
                            ForEach(extractedNeedToBuy, id: \.self) { item in
                                HStack(spacing: 4) {
                                    Text("•")
                                        .foregroundColor(Theme.yellow)
                                    Text(item)
                                        .font(.system(size: 12))
                                        .foregroundColor(Theme.text)
                                }
                            }
                        }
                    }

                    Spacer()

                    if !chatBubbles.isEmpty {
                        Button(action: {
                            withAnimation { step = .setup }
                        }) {
                            HStack(spacing: 6) {
                                Image(systemName: "arrow.right.circle.fill")
                                    .font(.system(size: 14))
                                Text("Videre til ukemeny")
                                    .font(.system(size: 13, weight: .semibold))
                            }
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(Theme.accent)
                            .cornerRadius(10)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(12)
                .frame(width: 180)
                .glassEffect(.clear, in: RoundedRectangle(cornerRadius: 12))
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
    }

    private func chatBubbleView(_ bubble: ChatBubble) -> some View {
        HStack {
            if bubble.role == "user" { Spacer(minLength: 60) }

            VStack(alignment: bubble.role == "user" ? .trailing : .leading, spacing: 2) {
                if bubble.role == "assistant" {
                    Text("Husmor")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(Theme.muted)
                }
                Text(bubble.text)
                    .font(.system(size: 14))
                    .foregroundColor(Theme.text)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .glassEffect(
                        bubble.role == "user" ? .regular.tint(Theme.accent) : .regular,
                        in: RoundedRectangle(cornerRadius: 12)
                    )
            }

            if bubble.role == "assistant" { Spacer(minLength: 60) }
        }
        .padding(.horizontal, 12)
    }

    private func toggleChatVoice() {
        if chatSpeech.isListening {
            chatSpeech.stopAndSend()
        } else {
            chatSpeaker.stop()
            chatSpeech.startActive()
        }
    }

    private func sendChatMessage() {
        let text = chatInput.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty, !isChatLoading else { return }
        chatInput = ""
        chatSpeech.stopListening()

        chatBubbles.append(ChatBubble(role: "user", text: text))
        chatMessages.append(MealsChatMessage(role: "user", content: text))
        isChatLoading = true

        Task {
            do {
                let response = try await api.mealChat(messages: chatMessages)
                chatMessages.append(MealsChatMessage(role: "assistant", content: response.reply))
                chatBubbles.append(ChatBubble(role: "assistant", text: response.reply))

                // Update extracted info
                if let extracted = response.extracted {
                    if let ingredients = extracted.ingredients {
                        extractedIngredients = ingredients
                    }
                    if let preferences = extracted.preferences {
                        extractedPreferences = preferences
                    }
                    if let needToBuy = extracted.needToBuy {
                        extractedNeedToBuy = needToBuy
                    }
                    if let ctx = extracted.context {
                        kitchenContext = ctx
                    }
                }

                // Speak the reply
                chatSpeaker.speak(response.reply)
            } catch {
                chatBubbles.append(ChatBubble(role: "assistant", text: "Beklager, noe gikk galt. Prov igjen."))
            }
            isChatLoading = false
        }
    }

    // MARK: - Helpers

    private var weekOffset: Int { planNextWeek ? 1 : 0 }

    /// Days before today (1-based, Mon=1..Sun=7)
    private var pastDays: [Int] {
        let today = todayDayOfWeek()
        return today > 1 ? Array(1..<today) : []
    }

    /// Days being planned — today onwards, or all 7 if next week
    private var visibleDays: [Int] {
        if planNextWeek { return Array(1...7) }
        let today = todayDayOfWeek()
        return Array(today...7)
    }

    private var daysToGenerate: [Int] {
        visibleDays.filter {
            guard let mode = dayModes[$0] else { return false }
            return mode.needsGeneration
        }
    }

    private var specialDays: [Int: DayMode] {
        dayModes.filter { visibleDays.contains($0.key) && $0.value.isSpecial }
    }

    private var prefilledDays: [Int: String] {
        var result: [Int: String] = [:]
        for (day, mode) in dayModes where visibleDays.contains(day) {
            if case .prefilled(let meal) = mode { result[day] = meal }
        }
        return result
    }

    // MARK: - Setup step

    private var setupView: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Ny ukemeny")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(Theme.text)

                if kitchenContext != nil {
                    Text("\u{1F9D1}\u{200D}\u{1F373} Husmor husker hva du fortalte")
                        .font(.system(size: 12))
                        .foregroundColor(Theme.green)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Theme.green.opacity(0.1))
                        .cornerRadius(8)
                }

                Spacer()

                Button(action: { withAnimation { step = .chat } }) {
                    HStack(spacing: 4) {
                        Image(systemName: "mic.fill")
                            .font(.system(size: 11))
                        Text("Snakk")
                            .font(.system(size: 12))
                    }
                    .foregroundColor(Theme.accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Theme.accent.opacity(0.15))
                    .cornerRadius(8)
                }
                .buttonStyle(.plain)

                Button("Avbryt") { onDone() }
                    .font(.system(size: 14))
                    .foregroundColor(Theme.muted)
                    .padding(.leading, 4)
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 12)

            // Instructions
            HStack {
                Text("Velg hva som skjer hver dag")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.muted)
                if planNextWeek {
                    Button(action: { withAnimation { planNextWeek = false } }) {
                        HStack(spacing: 4) {
                            Text("NESTE UKE")
                                .font(.system(size: 10, weight: .bold))
                            Image(systemName: "xmark")
                                .font(.system(size: 8, weight: .bold))
                        }
                        .foregroundColor(Theme.accent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Theme.accent.opacity(0.12))
                        .cornerRadius(5)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 12)

            // Day selector — past days shown as "neste uke" activators
            HStack(spacing: 10) {
                if !planNextWeek {
                    ForEach(pastDays, id: \.self) { day in
                        nextWeekDayCard(day)
                    }
                }
                ForEach(visibleDays, id: \.self) { day in
                    setupDayCard(day)
                }
            }
            .padding(.horizontal, 16)
            .frame(maxHeight: .infinity)

            // Day detail panel
            if let editing = editingDay {
                dayDetailPanel(editing)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            // Cuisine picker overlay
            if let day = showCuisinePicker {
                cuisinePickerView(for: day)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            // Generate button
            setupGenerateButton
                .padding(.bottom, 16)
        }
    }

    private func nextWeekDayCard(_ day: Int) -> some View {
        Button(action: {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                planNextWeek = true
            }
        }) {
            VStack(spacing: 8) {
                Text(dayNamesShort[day])
                    .font(.system(size: 16, weight: .bold))

                Image(systemName: "chevron.right.circle")
                    .font(.system(size: 28))

                Text("Neste uke")
                    .font(.system(size: 11, weight: .medium))
            }
            .foregroundColor(Theme.yellow)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.vertical, 20)
            .background(Theme.yellow.opacity(0.08))
            .cornerRadius(14)
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(Theme.yellow.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
            )
        }
        .buttonStyle(.plain)
    }

    private func setupDayCard(_ day: Int) -> some View {
        let mode = dayModes[day] ?? .generate
        let isEditing = editingDay == day

        return Button(action: {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                showCuisinePicker = nil
                cuisineSearch = ""
                if isEditing {
                    editingDay = nil
                } else {
                    editText = ""
                    editingDay = day
                }
            }
        }) {
            VStack(spacing: 8) {
                Text(dayNamesShort[day])
                    .font(.system(size: 16, weight: .bold))

                setupDayIcon(mode)

                setupDayLabel(mode)
            }
            .foregroundColor(setupDayColor(mode))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.vertical, 20)
            .background(setupDayBackground(mode))
            .cornerRadius(14)
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(isEditing ? Theme.accent : setupDayBorder(mode), lineWidth: isEditing ? 2 : 1)
            )
            .opacity(mode == .away ? 0.6 : 1)
        }
        .buttonStyle(.plain)
    }

    private func setupDayIcon(_ mode: DayMode) -> some View {
        Group {
            switch mode {
            case .generate:
                Image(systemName: "wand.and.stars").font(.system(size: 28))
            case .prefilled(let meal):
                Text(mealEmoji(for: meal)).font(.system(size: 28))
            case .away:
                Image(systemName: "airplane").font(.system(size: 28))
            case .fewerPeople:
                Image(systemName: "person.2").font(.system(size: 24))
            case .leftovers:
                Text("\u{1F372}").font(.system(size: 28))
            case .takeaway(let cuisine):
                Text(cuisine?.flag ?? "\u{1F961}").font(.system(size: 28))
            }
        }
    }

    private func setupDayLabel(_ mode: DayMode) -> some View {
        Group {
            switch mode {
            case .generate:
                Text("Generer").font(.system(size: 12, weight: .medium))
            case .prefilled(let meal):
                Text(meal).font(.system(size: 12, weight: .medium)).lineLimit(1)
            case .away:
                Text("Borte").font(.system(size: 12, weight: .medium))
            case .fewerPeople:
                Text("F\u{00E6}rre").font(.system(size: 12, weight: .medium))
            case .leftovers:
                Text("Rester").font(.system(size: 12, weight: .medium))
            case .takeaway(let cuisine):
                Text(cuisine?.name ?? "Takeaway").font(.system(size: 12, weight: .medium)).lineLimit(1)
            }
        }
    }

    private func setupDayColor(_ mode: DayMode) -> Color {
        switch mode {
        case .generate: return Theme.text
        case .prefilled: return Theme.green
        case .away: return Theme.muted
        case .fewerPeople: return Theme.accent
        case .leftovers: return Theme.yellow
        case .takeaway: return .orange
        }
    }

    private func setupDayBackground(_ mode: DayMode) -> some View {
        Group {
            switch mode {
            case .prefilled: Theme.green.opacity(0.1)
            case .away: Theme.surface.opacity(0.5)
            case .leftovers: Theme.yellow.opacity(0.08)
            case .takeaway: Color.orange.opacity(0.08)
            case .fewerPeople: Theme.accent.opacity(0.08)
            default: Theme.card
            }
        }
    }

    private func setupDayBorder(_ mode: DayMode) -> Color {
        switch mode {
        case .prefilled: return Theme.green.opacity(0.3)
        case .away: return Theme.muted.opacity(0.2)
        case .leftovers: return Theme.yellow.opacity(0.3)
        case .takeaway: return Color.orange.opacity(0.3)
        case .fewerPeople: return Theme.accent.opacity(0.3)
        default: return Theme.accent.opacity(0.3)
        }
    }

    // MARK: - Day detail panel

    private func dayDetailPanel(_ day: Int) -> some View {
        let mode = dayModes[day] ?? .generate

        return VStack(spacing: 12) {
            // Mode buttons
            HStack(spacing: 8) {
                Text("\(dayNames[day]):")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(Theme.text)
                    .frame(width: 85, alignment: .trailing)

                modeButton("Generer", icon: "wand.and.stars", isActive: mode == .generate) {
                    dayModes[day] = .generate
                }
                modeButton("Borte", icon: "airplane", isActive: mode == .away) {
                    dayModes[day] = .away
                }
                modeButton("F\u{00E6}rre", icon: "person.2", isActive: mode == .fewerPeople) {
                    dayModes[day] = .fewerPeople
                }
                modeButton("Rester", icon: "arrow.uturn.left", isActive: mode == .leftovers) {
                    dayModes[day] = .leftovers
                }
                modeButton("Takeaway", icon: "bag", isActive: isTakeaway(mode)) {
                    dayModes[day] = .takeaway(nil)
                    showCuisinePicker = day
                    cuisineSearch = ""
                }

                Spacer()

                // Close
                Button(action: { withAnimation { editingDay = nil } }) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundColor(Theme.muted)
                }
                .buttonStyle(.plain)
            }

            // Prefill text field (for generate and fewer modes)
            if case .generate = mode {
                prefillField(day)
            } else if case .fewerPeople = mode {
                prefillField(day)
            }

            // Takeaway cuisine badge
            if case .takeaway(let cuisine) = mode, let c = cuisine {
                HStack(spacing: 6) {
                    Text(c.flag).font(.system(size: 14))
                    Text(c.name)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Theme.text)
                    Button(action: {
                        showCuisinePicker = day
                        cuisineSearch = ""
                    }) {
                        Text("Bytt")
                            .font(.system(size: 11))
                            .foregroundColor(Theme.accent)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(12)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 12))
    }

    private func prefillField(_ day: Int) -> some View {
        HStack(spacing: 8) {
            TextField("", text: $editText, prompt: Text("Skriv inn rett (valgfritt)...").foregroundColor(Theme.muted))
                .font(.system(size: 14))
                .foregroundColor(Theme.text)
                .textFieldStyle(.plain)
                .onSubmit { submitPrefill(day) }

            if !editText.isEmpty {
                Button(action: { submitPrefill(day) }) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundColor(Theme.green)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(8)
        .background(Theme.surface)
        .cornerRadius(8)
    }

    private func modeButton(_ label: String, icon: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                action()
                showCuisinePicker = nil
            }
        }) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 14))
                Text(label).font(.system(size: 14, weight: .medium))
            }
            .foregroundColor(isActive ? .white : Theme.muted)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(isActive ? Theme.accent : Theme.surface)
            .cornerRadius(10)
        }
        .buttonStyle(.plain)
    }

    private func isTakeaway(_ mode: DayMode) -> Bool {
        if case .takeaway = mode { return true }
        return false
    }

    // MARK: - Cuisine picker

    private func cuisinePickerView(for day: Int) -> some View {
        let filtered = cuisineSearch.isEmpty
            ? popularCuisines
            : popularCuisines.filter { $0.name.localizedCaseInsensitiveContains(cuisineSearch) }

        return VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.muted)
                TextField("", text: $cuisineSearch, prompt: Text("S\u{00F8}k land...").foregroundColor(Theme.muted))
                    .font(.system(size: 13))
                    .foregroundColor(Theme.text)
                    .textFieldStyle(.plain)
            }
            .padding(8)
            .background(Theme.surface)
            .cornerRadius(8)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    // "No cuisine" option
                    Button(action: {
                        withAnimation {
                            dayModes[day] = .takeaway(nil)
                            showCuisinePicker = nil
                        }
                    }) {
                        Text("\u{1F961} Takeaway")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(Theme.text)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Theme.surface)
                            .cornerRadius(7)
                    }
                    .buttonStyle(.plain)

                    ForEach(filtered) { cuisine in
                        Button(action: {
                            withAnimation {
                                dayModes[day] = .takeaway(cuisine)
                                showCuisinePicker = nil
                            }
                        }) {
                            HStack(spacing: 4) {
                                Text(cuisine.flag).font(.system(size: 14))
                                Text(cuisine.name).font(.system(size: 12, weight: .medium))
                            }
                            .foregroundColor(Theme.text)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Theme.surface)
                            .cornerRadius(7)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(10)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Generate button

    private var setupGenerateButton: some View {
        let genCount = daysToGenerate.count
        let specialCount = specialDays.count
        let prefilledCount = prefilledDays.count
        let totalDays = genCount + specialCount + prefilledCount

        return Button(action: {
            step = .loading
            Task { await generate() }
        }) {
            HStack(spacing: 8) {
                Image(systemName: "wand.and.stars")
                    .font(.system(size: 18))
                if genCount == 0 && totalDays > 0 {
                    Text("Godkjenn \(totalDays) dager")
                        .font(.system(size: 17, weight: .semibold))
                } else if genCount > 0 {
                    Text("Lag meny (\(genCount) generer, \(totalDays - genCount) valgt)")
                        .font(.system(size: 17, weight: .semibold))
                } else {
                    Text("Lag ukemeny")
                        .font(.system(size: 17, weight: .semibold))
                }
            }
            .foregroundColor(.white)
            .frame(maxWidth: 400)
            .padding(.vertical, 14)
            .glassEffect(.regular.tint(Theme.accent).interactive(), in: RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 20)
        .padding(.bottom, 20)
    }

    private func submitPrefill(_ day: Int) {
        let trimmed = editText.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty {
            dayModes[day] = .prefilled(trimmed)
        }
        editText = ""
        withAnimation { editingDay = nil }
    }

    // MARK: - Loading

    private var loadingView: some View {
        VStack(spacing: 20) {
            ProgressView()
                .tint(Theme.accent)
                .scaleEffect(1.5)
            Text("Husmor planlegger...")
                .font(.system(size: 18, weight: .medium))
                .foregroundColor(Theme.text)
            Text("Finner de beste middagene for familien")
                .font(.system(size: 14))
                .foregroundColor(Theme.muted)
        }
    }

    // MARK: - Error

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundColor(Theme.yellow)
            Text(message)
                .font(.system(size: 16))
                .foregroundColor(Theme.text)
            Button("Prov igjen") {
                error = nil
                days = []
                revealedDays = []
                step = .loading
                Task { await generate() }
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(Theme.accent)
            .padding(.horizontal, 24)
            .padding(.vertical, 10)
            .background(Theme.accent.opacity(0.15))
            .cornerRadius(12)

            Button("Tilbake til oppsettet") {
                error = nil
                days = []
                revealedDays = []
                step = .setup
            }
            .font(.system(size: 14))
            .foregroundColor(Theme.muted)

            Button("Lukk") { onDone() }
                .font(.system(size: 13))
                .foregroundColor(Theme.muted)
                .padding(.top, 8)
        }
    }

    // MARK: - Result

    /// Days with actual generated/prefilled meal suggestions (not away/leftovers/takeaway)
    private var suggestionDays: [GeneratedDay] {
        days.filter { day in
            let mode = dayModes[day.dayOfWeek]
            if mode == .away || mode == .leftovers { return false }
            if case .takeaway = mode { return false }
            return true
        }
    }

    /// Summary of non-suggestion days for the header
    private var specialDaySummary: String? {
        let specials = visibleDays.compactMap { dayNum -> String? in
            guard let mode = dayModes[dayNum] else { return nil }
            switch mode {
            case .away: return "\(dayNamesShort[dayNum]) borte"
            case .leftovers: return "\(dayNamesShort[dayNum]) rester"
            case .takeaway: return "\(dayNamesShort[dayNum]) takeaway"
            default: return nil
            }
        }
        return specials.isEmpty ? nil : specials.joined(separator: ", ")
    }

    private var planView: some View {
        VStack(spacing: 0) {
            // Header — tight
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text("Forslag til ukemeny")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundColor(Theme.text)
                        if planNextWeek {
                            Text("NESTE UKE")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(Theme.accent)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(Theme.accent.opacity(0.12))
                                .cornerRadius(5)
                        }
                    }
                    if let summary = specialDaySummary {
                        Text(summary)
                            .font(.system(size: 11))
                            .foregroundColor(Theme.dimmed)
                    }
                }
                Spacer()

                Button("Avbryt") { onDone() }
                    .font(.system(size: 14))
                    .foregroundColor(Theme.muted)
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 10)

            // Only show cards for days that need suggestions — wider, fewer
            HStack(spacing: 12) {
                ForEach(suggestionDays, id: \.dayOfWeek) { day in
                    let idx = selectedOption[day.dayOfWeek] ?? 0
                    let option = day.options[safe: idx] ?? day.options[0]
                    let isRevealed = revealedDays.contains(day.dayOfWeek)
                    let source = mealSources[day.dayOfWeek] ?? .husmor
                    let locked = lockedDays.contains(day.dayOfWeek)

                    DayCard(
                        dayName: dayNames[day.dayOfWeek],
                        dateString: formatDayDate(day.date),
                        contextLine: day.contextLine,
                        busyness: day.busyness,
                        option: option,
                        alternativeCount: day.options.count,
                        currentIndex: idx,
                        isRevealed: isRevealed,
                        source: source,
                        isLocked: locked
                    )
                    .onTapGesture {
                        guard isRevealed else { return }
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                            showActionDay = showActionDay == day.dayOfWeek ? nil : day.dayOfWeek
                            manualMealText = ""
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .frame(maxHeight: .infinity)

            // Action panel for selected day
            if let actionDay = showActionDay,
               let day = days.first(where: { $0.dayOfWeek == actionDay }) {
                dayActionPanel(day)
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            // Bottom: Godkjenn meny
            if !days.isEmpty {
                Button(action: confirmPlan) {
                    HStack(spacing: 8) {
                        if isSaving {
                            ProgressView().tint(.white).scaleEffect(0.8)
                        } else {
                            Image(systemName: "checkmark.circle.fill").font(.system(size: 16))
                        }
                        Text("Godkjenn meny")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: 360)
                    .padding(.vertical, 12)
                    .glassEffect(.regular.tint(Theme.green).interactive(), in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .disabled(isSaving)
                .padding(.horizontal, 20)
                .padding(.bottom, 16)
                .padding(.top, 8)
            }
        }
    }

    // MARK: - Day action panel

    private func dayActionPanel(_ day: GeneratedDay) -> some View {
        let locked = lockedDays.contains(day.dayOfWeek)
        let hasAlts = day.options.count > 1

        return VStack(spacing: 10) {
            HStack(spacing: 8) {
                Text("\(dayNames[day.dayOfWeek]):")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Theme.text)

                // Swap
                if hasAlts && !locked {
                    Button(action: {
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
                            let next = ((selectedOption[day.dayOfWeek] ?? 0) + 1) % day.options.count
                            selectedOption[day.dayOfWeek] = next
                            mealSources[day.dayOfWeek] = .husmor
                        }
                    }) {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .font(.system(size: 10))
                            Text("Bytt")
                                .font(.system(size: 11, weight: .medium))
                        }
                        .foregroundColor(Theme.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .background(Theme.accent.opacity(0.12))
                        .cornerRadius(7)
                    }
                    .buttonStyle(.plain)
                }

                // Lock/unlock
                Button(action: {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                        if locked {
                            lockedDays.remove(day.dayOfWeek)
                            mealSources[day.dayOfWeek] = .husmor
                        } else {
                            lockedDays.insert(day.dayOfWeek)
                            mealSources[day.dayOfWeek] = .locked
                        }
                    }
                }) {
                    HStack(spacing: 4) {
                        Image(systemName: locked ? "lock.open.fill" : "lock.fill")
                            .font(.system(size: 10))
                        Text(locked ? "L\u{00E5}s opp" : "L\u{00E5}s")
                            .font(.system(size: 11, weight: .medium))
                    }
                    .foregroundColor(Theme.yellow)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(Theme.yellow.opacity(0.12))
                    .cornerRadius(7)
                }
                .buttonStyle(.plain)

                Spacer()

                // Close
                Button(action: { withAnimation { showActionDay = nil } }) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundColor(Theme.muted)
                }
                .buttonStyle(.plain)
            }

            // Manual meal input
            HStack(spacing: 8) {
                TextField("", text: $manualMealText, prompt: Text("Velg selv...").foregroundColor(Theme.muted))
                    .font(.system(size: 14))
                    .foregroundColor(Theme.text)
                    .textFieldStyle(.plain)
                    .onSubmit { submitManualMeal(day.dayOfWeek) }

                if !manualMealText.isEmpty {
                    Button(action: { submitManualMeal(day.dayOfWeek) }) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 18))
                            .foregroundColor(Theme.green)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(8)
            .background(Theme.surface)
            .cornerRadius(8)
        }
        .padding(12)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 12))
    }

    private func submitManualMeal(_ dayOfWeek: Int) {
        let trimmed = manualMealText.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }

        // Replace the day's options with the manual meal
        let manualDay = GeneratedDay(
            dayOfWeek: dayOfWeek,
            date: days.first(where: { $0.dayOfWeek == dayOfWeek })?.date,
            contextLine: days.first(where: { $0.dayOfWeek == dayOfWeek })?.contextLine,
            busyness: days.first(where: { $0.dayOfWeek == dayOfWeek })?.busyness,
            options: [MealOption(name: trimmed, description: nil, category: nil, reasoning: nil, planB: nil, cookTimeMin: nil, startTime: nil)]
        )
        days.removeAll { $0.dayOfWeek == dayOfWeek }
        days.append(manualDay)
        days.sort { $0.dayOfWeek < $1.dayOfWeek }
        selectedOption[dayOfWeek] = 0
        mealSources[dayOfWeek] = .user
        lockedDays.insert(dayOfWeek)
        manualMealText = ""
        withAnimation { showActionDay = nil }
    }

    private var hasUndecidedDays: Bool {
        visibleDays.contains { dayNum in
            let mode = dayModes[dayNum] ?? .generate
            return mode.needsGeneration && !days.contains(where: { $0.dayOfWeek == dayNum })
        }
    }

    private func fillRest() {
        // Re-generate for unfilled days, keeping current selections as prefilled
        step = .loading
        Task { await generate() }
    }

    // specialResultCard removed — only show days with actual suggestions

    // MARK: - Actions

    private func generate() async {
        var prefilled = prefilledDays

        // Locked days with existing selections also count as prefilled
        for dayNum in lockedDays {
            if let day = days.first(where: { $0.dayOfWeek == dayNum }) {
                let idx = selectedOption[dayNum] ?? 0
                let option = day.options[safe: idx] ?? day.options[0]
                prefilled[dayNum] = option.name
            }
        }

        // Add prefilled meals as already-revealed days
        for (dayNum, meal) in prefilled where !days.contains(where: { $0.dayOfWeek == dayNum }) {
            let prefilledDay = GeneratedDay(
                dayOfWeek: dayNum,
                date: nil,
                contextLine: nil,
                busyness: nil,
                options: [MealOption(name: meal, description: nil, category: nil, reasoning: nil, planB: nil, cookTimeMin: nil, startTime: nil)]
            )
            days.append(prefilledDay)
            revealedDays.insert(dayNum)
            if mealSources[dayNum] == nil {
                mealSources[dayNum] = .user
            }
        }

        let toGenerate = daysToGenerate

        if toGenerate.isEmpty {
            days.sort { $0.dayOfWeek < $1.dayOfWeek }
            step = .result
            return
        }

        // Build skip days: days not visible + special days
        let hiddenDays = Set(1...7).subtracting(visibleDays)
        let specialSkip = visibleDays.filter { day in
            guard let mode = dayModes[day] else { return false }
            return mode.isSpecial
        }
        let skipDays = (Array(hiddenDays) + specialSkip).sorted()

        // "Fewer people" days still get generated but with a note
        let fewerDays = visibleDays.filter { dayModes[$0] == .fewerPeople }

        do {
            let prefilledParam = prefilled.map { (key, value) in ["dayOfWeek": "\(key)", "meal": value] }
            var context = kitchenContext ?? ""
            if !fewerDays.isEmpty {
                let dayLabels = fewerDays.map { dayNames[$0] }.joined(separator: ", ")
                context += "\nF\u{00E6}rre personer spiser \(dayLabels) \u{2014} lag en enklere rett med mindre porsjoner."
            }
            let result = try await api.generateMealPlan(
                skipDays: skipDays,
                prefilledMeals: prefilledParam,
                kitchenContext: context.isEmpty ? nil : context,
                weekOffset: weekOffset
            )
            guard let generatedDays = result.days, !generatedDays.isEmpty else {
                error = "Ingen meny ble generert"
                step = .result
                return
            }
            for gd in generatedDays {
                if !days.contains(where: { $0.dayOfWeek == gd.dayOfWeek }) {
                    days.append(gd)
                    mealSources[gd.dayOfWeek] = .husmor
                }
            }
            days.sort { $0.dayOfWeek < $1.dayOfWeek }
            reply = result.reply
            step = .result

            for day in days where prefilled[day.dayOfWeek] == nil {
                try? await Task.sleep(nanoseconds: 200_000_000)
                withAnimation(.spring(response: 0.5, dampingFraction: 0.75)) {
                    revealedDays.insert(day.dayOfWeek)
                }
            }
        } catch let err {
            if let apiErr = err as? APIError {
                switch apiErr {
                case .unauthorized:
                    self.error = "Sesjonen har utl\u{00F8}pt. Logg inn p\u{00E5} nytt."
                case .httpError(let code):
                    self.error = "Serverfeil (\(code)). Pr\u{00F8}v igjen."
                default:
                    self.error = "Kunne ikke generere meny"
                }
            } else {
                self.error = "Nettverksfeil: \(err.localizedDescription)"
            }
            step = .result
        }
    }

    private func confirmPlan() {
        isSaving = true
        Task {
            // Build confirm meals from generated days + special days
            var confirmMeals: [ConfirmMeal] = days.map { day in
                let idx = selectedOption[day.dayOfWeek] ?? 0
                let option = day.options[safe: idx] ?? day.options[0]
                let source = mealSources[day.dayOfWeek] ?? .husmor
                let suggestedBy = source == .user || source == .locked ? "user" : "husmor"
                return ConfirmMeal(
                    dayOfWeek: day.dayOfWeek,
                    name: option.name,
                    description: option.description,
                    mealType: "dinner",
                    yieldsLeftovers: false,
                    suggestedBy: suggestedBy
                )
            }

            // Add special days
            for dayNum in visibleDays {
                guard let mode = dayModes[dayNum] else { continue }
                switch mode {
                case .leftovers:
                    confirmMeals.append(ConfirmMeal(
                        dayOfWeek: dayNum, name: "Rester", description: nil,
                        mealType: "leftovers", yieldsLeftovers: false, suggestedBy: "user"
                    ))
                case .takeaway(let cuisine):
                    let name = cuisine != nil ? "Takeaway \(cuisine!.flag) \(cuisine!.name)" : "Takeaway"
                    confirmMeals.append(ConfirmMeal(
                        dayOfWeek: dayNum, name: name, description: nil,
                        mealType: "takeaway", yieldsLeftovers: false, suggestedBy: "user"
                    ))
                case .away:
                    confirmMeals.append(ConfirmMeal(
                        dayOfWeek: dayNum, name: "Borte", description: nil,
                        mealType: "away", yieldsLeftovers: false, suggestedBy: "user"
                    ))
                default:
                    break
                }
            }

            confirmMeals.sort { $0.dayOfWeek < $1.dayOfWeek }
            do {
                try await api.confirmMealPlan(meals: confirmMeals, weekOffset: weekOffset)
                try? await Task.sleep(nanoseconds: 300_000_000)
                await MainActor.run { onDone() }
            } catch let err {
                isSaving = false
                if let apiErr = err as? APIError {
                    switch apiErr {
                    case .unauthorized:
                        self.error = "Sesjonen har utl\u{00F8}pt. Logg inn p\u{00E5} nytt."
                    case .httpError(let code):
                        self.error = "Kunne ikke lagre (\(code)). Pr\u{00F8}v igjen."
                    default:
                        self.error = "Kunne ikke lagre ukemenyen"
                    }
                } else {
                    self.error = "Nettverksfeil: \(err.localizedDescription)"
                }
            }
        }
    }
}
