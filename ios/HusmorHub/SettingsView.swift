import SwiftUI

struct SettingsView: View {
    @ObservedObject var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var settings: HubSettings?
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var savedFeedback = false
    @State private var showAnalytics = false

    // Editable fields
    @State private var dinnerHour = 17
    @State private var dinnerMinute = 0
    @State private var proactiveEnabled = true
    @State private var proactiveVoice = true
    @State private var householdName = ""
    @State private var householdSize = 4
    @State private var country = "NO"
    @State private var speakerVolume: Double = Double(UserDefaults.standard.object(forKey: "speaker_volume") as? Float ?? 0.8)

    // Meal planning settings
    @State private var dayTypes: [Int: String] = [:]   // day-of-week → type
    @State private var staples: [String] = []
    @State private var newStaple = ""
    @State private var fishTarget = 2
    @State private var veggieTarget = 1
    @State private var maxCookingTime = 45
    @State private var traditions: [Int: String] = [:]  // day-of-week → meal name
    @State private var editingTraditionDay: Int? = nil
    @State private var traditionText = ""

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            if isLoading {
                ProgressView()
                    .tint(Theme.accent)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        header

                        // Two-column grid for compact sections
                        HStack(alignment: .top, spacing: 20) {
                            VStack(spacing: 24) {
                                settingsSection("M\u{00E5}ltider") {
                                    dinnerTimePicker
                                }

                                settingsSection("Husstand") {
                                    householdNameField
                                    Divider().background(Theme.surface)
                                    householdSizePicker
                                }

                                settingsSection("Proaktive meldinger") {
                                    proactiveToggle
                                    if proactiveEnabled {
                                        voiceToggle
                                        if proactiveVoice {
                                            Divider().background(Theme.surface)
                                            volumeSlider
                                        }
                                    }
                                }

                                settingsSection("Land og kalender") {
                                    countryPicker
                                }
                            }
                            .frame(maxWidth: .infinity)

                            VStack(spacing: 24) {
                                settingsSection("Ukerytme") {
                                    dayTypesSection
                                }

                                settingsSection("Tradisjoner") {
                                    traditionsSection
                                }

                                settingsSection("Basisvarer") {
                                    staplesSection
                                }

                                settingsSection("Kostm\u{00E5}l") {
                                    dietaryTargetsSection
                                }
                            }
                            .frame(maxWidth: .infinity)
                        }

                        HStack(spacing: 16) {
                            saveButton
                            analyticsButton
                        }
                    }
                    .padding(32)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .task { await load() }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Innstillinger")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(Theme.text)
                Text("Tilpass Husmor Hub")
                    .font(.system(size: 14))
                    .foregroundColor(Theme.muted)
            }
            Spacer()
            Button(action: { dismiss() }) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 28))
                    .foregroundColor(Theme.muted)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Sections

    private func settingsSection(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Theme.muted)
                .textCase(.uppercase)
                .tracking(1)

            VStack(spacing: 0) {
                content()
            }
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    // MARK: - Dinner time

    private var dinnerTimePicker: some View {
        HStack {
            Label("Middagstid", systemImage: "fork.knife")
                .font(.system(size: 15))
                .foregroundColor(Theme.text)

            Spacer()

            HStack(spacing: 4) {
                Picker("", selection: $dinnerHour) {
                    ForEach(15...21, id: \.self) { h in
                        Text(String(format: "%02d", h)).tag(h)
                    }
                }
                .pickerStyle(.wheel)
                .frame(width: 60, height: 80)
                .clipped()

                Text(":")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(Theme.muted)

                Picker("", selection: $dinnerMinute) {
                    ForEach([0, 15, 30, 45], id: \.self) { m in
                        Text(String(format: "%02d", m)).tag(m)
                    }
                }
                .pickerStyle(.wheel)
                .frame(width: 60, height: 80)
                .clipped()
            }
        }
        .padding(16)
    }

    // MARK: - Toggles

    private var proactiveToggle: some View {
        Toggle(isOn: $proactiveEnabled) {
            Label("Proaktive meldinger", systemImage: "bubble.left.fill")
                .font(.system(size: 15))
                .foregroundColor(Theme.text)
        }
        .tint(Theme.accent)
        .padding(16)
    }

    private var voiceToggle: some View {
        VStack(spacing: 0) {
            Divider().background(Theme.surface)
            Toggle(isOn: $proactiveVoice) {
                Label("Les opp meldinger", systemImage: "speaker.wave.2.fill")
                    .font(.system(size: 15))
                    .foregroundColor(Theme.text)
            }
            .tint(Theme.accent)
            .padding(16)
        }
    }

    // MARK: - Volume

    private var volumeSlider: some View {
        HStack(spacing: 12) {
            Image(systemName: "speaker.fill")
                .font(.system(size: 13))
                .foregroundColor(Theme.muted)

            Slider(value: $speakerVolume, in: 0...1, step: 0.1)
                .tint(Theme.accent)
                .onChange(of: speakerVolume) {
                    UserDefaults.standard.set(Float(speakerVolume), forKey: "speaker_volume")
                }

            Image(systemName: "speaker.wave.3.fill")
                .font(.system(size: 13))
                .foregroundColor(Theme.muted)

            Text("\(Int(speakerVolume * 100))%")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundColor(Theme.muted)
                .frame(width: 36)
        }
        .padding(16)
    }

    // MARK: - Household name

    private var householdNameField: some View {
        HStack {
            Label("Husstandnavn", systemImage: "house.fill")
                .font(.system(size: 15))
                .foregroundColor(Theme.text)

            Spacer()

            TextField("", text: $householdName, prompt: Text("F.eks. Familien Hansen").foregroundColor(Theme.muted))
                .font(.system(size: 15))
                .foregroundColor(Theme.text)
                .multilineTextAlignment(.trailing)
                .textFieldStyle(.plain)
                .frame(maxWidth: 200)
        }
        .padding(16)
    }

    // MARK: - Household size

    private var householdSizePicker: some View {
        HStack {
            Label("Antall personer", systemImage: "person.3.fill")
                .font(.system(size: 15))
                .foregroundColor(Theme.text)

            Spacer()

            HStack(spacing: 0) {
                Button(action: { if householdSize > 1 { householdSize -= 1 } }) {
                    Image(systemName: "minus.circle.fill")
                        .font(.system(size: 22))
                        .foregroundColor(householdSize > 1 ? Theme.accent : Theme.muted)
                }
                .buttonStyle(.plain)
                .disabled(householdSize <= 1)

                Text("\(householdSize)")
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundColor(Theme.text)
                    .frame(width: 40)
                    .multilineTextAlignment(.center)

                Button(action: { if householdSize < 8 { householdSize += 1 } }) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 22))
                        .foregroundColor(householdSize < 8 ? Theme.accent : Theme.muted)
                }
                .buttonStyle(.plain)
                .disabled(householdSize >= 8)
            }
        }
        .padding(16)
    }

    // MARK: - Country

    private var countryPicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Land", systemImage: "globe.europe.africa")
                .font(.system(size: 15))
                .foregroundColor(Theme.text)

            Text("Helligdagskalender f\u{00F8}lger valgt land")
                .font(.system(size: 12))
                .foregroundColor(Theme.muted)

            HStack(spacing: 10) {
                countryOption(code: "NO", flag: "\u{1F1F3}\u{1F1F4}", name: "Norge")
                countryOption(code: "SE", flag: "\u{1F1F8}\u{1F1EA}", name: "Sverige")
                countryOption(code: "DK", flag: "\u{1F1E9}\u{1F1F0}", name: "Danmark")
            }
        }
        .padding(16)
    }

    private func countryOption(code: String, flag: String, name: String) -> some View {
        Button(action: { withAnimation { country = code } }) {
            VStack(spacing: 4) {
                Text(flag)
                    .font(.system(size: 28))
                Text(name)
                    .font(.system(size: 12, weight: country == code ? .bold : .medium))
                    .foregroundColor(country == code ? Theme.text : Theme.muted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(country == code ? Theme.accent.opacity(0.12) : Theme.surface.opacity(0.5))
            .cornerRadius(10)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(country == code ? Theme.accent.opacity(0.4) : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Day types

    private let dayTypeOptions = ["", "rask", "fisk", "koselig", "pizza", "enkel"]
    private let dayTypeLabels = ["\u{2014}", "\u{26A1}", "\u{1F41F}", "\u{2615}", "\u{1F355}", "\u{1F373}"]
    private let dayTypeTitles = ["Ingen", "Rask", "Fisk", "Koselig", "Pizza", "Enkel"]
    private let weekDayNames = ["Man", "Tir", "Ons", "Tor", "Fre", "L\u{00F8}r", "S\u{00F8}n"]

    private let dayTypeEmojis = ["", "\u{26A1}", "\u{1F41F}", "\u{2615}", "\u{1F355}", "\u{1F373}"]

    private var dayTypesSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Legend
            HStack(spacing: 12) {
                ForEach(1..<dayTypeOptions.count, id: \.self) { i in
                    HStack(spacing: 3) {
                        Text(dayTypeLabels[i]).font(.system(size: 14))
                        Text(dayTypeTitles[i]).font(.system(size: 11)).foregroundColor(Theme.muted)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)

            ForEach(1...7, id: \.self) { day in
                HStack(spacing: 8) {
                    Text(weekDayNames[day - 1])
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Theme.text)
                        .frame(width: 36, alignment: .leading)

                    ForEach(0..<dayTypeOptions.count, id: \.self) { i in
                        let opt = dayTypeOptions[i]
                        let label = dayTypeLabels[i]
                        let selected = (dayTypes[day] ?? "") == opt
                        Button(action: {
                            withAnimation {
                                if opt.isEmpty { dayTypes.removeValue(forKey: day) }
                                else { dayTypes[day] = opt }
                            }
                        }) {
                            Text(label)
                                .font(.system(size: 18))
                                .frame(width: 40, height: 40)
                                .background(selected ? Theme.accent : Theme.surface)
                                .cornerRadius(8)
                        }
                        .buttonStyle(.plain)
                    }

                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)
            }
            .padding(.bottom, 12)
        }
    }

    // MARK: - Traditions

    private var traditionsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Faste middager p\u{00E5} bestemte dager")
                .font(.system(size: 12))
                .foregroundColor(Theme.muted)
                .padding(.horizontal, 16)
                .padding(.top, 12)

            ForEach(1...7, id: \.self) { day in
                HStack {
                    Text(weekDayNames[day - 1])
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(Theme.text)
                        .frame(width: 36, alignment: .leading)

                    if let meal = traditions[day] {
                        Text(meal)
                            .font(.system(size: 13))
                            .foregroundColor(Theme.accent)

                        Spacer()

                        Button(action: { traditions.removeValue(forKey: day) }) {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 14))
                                .foregroundColor(Theme.muted)
                        }
                        .buttonStyle(.plain)
                    } else if editingTraditionDay == day {
                        TextField("F.eks. Taco", text: $traditionText)
                            .font(.system(size: 13))
                            .foregroundColor(Theme.text)
                            .textFieldStyle(.plain)
                            .onSubmit {
                                if !traditionText.trimmingCharacters(in: .whitespaces).isEmpty {
                                    traditions[day] = traditionText.trimmingCharacters(in: .whitespaces)
                                }
                                editingTraditionDay = nil
                                traditionText = ""
                            }

                        Spacer()
                    } else {
                        Spacer()
                        Button(action: {
                            editingTraditionDay = day
                            traditionText = ""
                        }) {
                            Image(systemName: "plus.circle")
                                .font(.system(size: 14))
                                .foregroundColor(Theme.muted)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }
            .padding(.bottom, 12)
        }
    }

    // MARK: - Staples

    private var staplesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Varer familien alltid har hjemme")
                .font(.system(size: 12))
                .foregroundColor(Theme.muted)
                .padding(.horizontal, 16)
                .padding(.top, 12)

            // Wrapped tags
            FlowLayout(spacing: 6) {
                ForEach(staples, id: \.self) { item in
                    HStack(spacing: 4) {
                        Text(item)
                            .font(.system(size: 12))
                            .foregroundColor(Theme.text)
                        Button(action: { staples.removeAll { $0 == item } }) {
                            Image(systemName: "xmark")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundColor(Theme.muted)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Theme.surface.opacity(0.5))
                    .cornerRadius(6)
                }
            }
            .padding(.horizontal, 16)

            // Add new staple
            HStack(spacing: 8) {
                TextField("Legg til basisvare", text: $newStaple)
                    .font(.system(size: 13))
                    .foregroundColor(Theme.text)
                    .textFieldStyle(.plain)
                    .onSubmit { addStaple() }

                Button(action: addStaple) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 18))
                        .foregroundColor(newStaple.isEmpty ? Theme.muted : Theme.accent)
                }
                .buttonStyle(.plain)
                .disabled(newStaple.isEmpty)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
    }

    private func addStaple() {
        let trimmed = newStaple.trimmingCharacters(in: .whitespaces).lowercased()
        guard !trimmed.isEmpty, !staples.contains(trimmed) else { return }
        staples.append(trimmed)
        newStaple = ""
    }

    // MARK: - Dietary targets

    private var dietaryTargetsSection: some View {
        VStack(spacing: 0) {
            targetRow(label: "Fisk per uke", icon: "fish.fill", value: $fishTarget, range: 0...5)
            Divider().background(Theme.surface)
            targetRow(label: "Vegetar per uke", icon: "leaf.fill", value: $veggieTarget, range: 0...5)
            Divider().background(Theme.surface)
            HStack {
                Label("Maks tilberedningstid", systemImage: "clock.fill")
                    .font(.system(size: 15))
                    .foregroundColor(Theme.text)

                Spacer()

                HStack(spacing: 4) {
                    Button(action: { if maxCookingTime > 15 { maxCookingTime -= 5 } }) {
                        Image(systemName: "minus.circle.fill")
                            .font(.system(size: 22))
                            .foregroundColor(maxCookingTime > 15 ? Theme.accent : Theme.muted)
                    }
                    .buttonStyle(.plain)

                    Text("\(maxCookingTime) min")
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundColor(Theme.text)
                        .frame(width: 60)
                        .multilineTextAlignment(.center)

                    Button(action: { if maxCookingTime < 90 { maxCookingTime += 5 } }) {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 22))
                            .foregroundColor(maxCookingTime < 90 ? Theme.accent : Theme.muted)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
    }

    private func targetRow(label: String, icon: String, value: Binding<Int>, range: ClosedRange<Int>) -> some View {
        HStack {
            Label(label, systemImage: icon)
                .font(.system(size: 15))
                .foregroundColor(Theme.text)

            Spacer()

            HStack(spacing: 0) {
                Button(action: { if value.wrappedValue > range.lowerBound { value.wrappedValue -= 1 } }) {
                    Image(systemName: "minus.circle.fill")
                        .font(.system(size: 22))
                        .foregroundColor(value.wrappedValue > range.lowerBound ? Theme.accent : Theme.muted)
                }
                .buttonStyle(.plain)

                Text("\(value.wrappedValue)")
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundColor(Theme.text)
                    .frame(width: 40)
                    .multilineTextAlignment(.center)

                Button(action: { if value.wrappedValue < range.upperBound { value.wrappedValue += 1 } }) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 22))
                        .foregroundColor(value.wrappedValue < range.upperBound ? Theme.accent : Theme.muted)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
    }

    // MARK: - Save

    private var saveButton: some View {
        Button(action: { Task { await save() } }) {
            HStack(spacing: 8) {
                if isSaving {
                    ProgressView()
                        .scaleEffect(0.8)
                        .tint(.white)
                } else if savedFeedback {
                    Image(systemName: "checkmark")
                        .font(.system(size: 14, weight: .bold))
                } else {
                    Image(systemName: "square.and.arrow.down")
                        .font(.system(size: 14))
                }
                Text(savedFeedback ? "Lagret!" : "Lagre endringer")
                    .font(.system(size: 15, weight: .semibold))
            }
            .foregroundColor(.white)
            .padding(.horizontal, 24)
            .padding(.vertical, 14)
            .glassEffect(.regular.tint(savedFeedback ? Theme.green : Theme.accent).interactive(), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(isSaving)
    }

    // MARK: - Analytics

    private var analyticsButton: some View {
        Button(action: { showAnalytics = true }) {
            HStack(spacing: 8) {
                Image(systemName: "chart.bar.xaxis")
                    .font(.system(size: 14))
                Text("Bruksanalyse")
                    .font(.system(size: 15, weight: .medium))
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.muted)
            }
            .foregroundColor(Theme.text)
            .padding(16)
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showAnalytics) {
            AnalyticsView(api: api)
                .presentationDetents([.large])
        }
    }

    // MARK: - Data

    private func load() async {
        do {
            let s = try await api.fetchSettings()
            settings = s
            // Parse dinner time
            let parts = s.dinnerTime.split(separator: ":")
            if parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) {
                dinnerHour = h
                dinnerMinute = m
            }
            proactiveEnabled = s.proactiveEnabled
            proactiveVoice = s.proactiveVoice
            householdName = s.householdName
            householdSize = s.householdSize
            country = s.country
            // Meal planning settings
            if let dt = s.dayTypes {
                dayTypes = dt.reduce(into: [:]) { dict, pair in
                    if let key = Int(pair.key) { dict[key] = pair.value }
                }
            }
            staples = s.staples ?? []
            fishTarget = s.fishTarget ?? 2
            veggieTarget = s.veggieTarget ?? 1
            maxCookingTime = s.maxCookingTime ?? 45
            if let tr = s.traditions {
                traditions = tr.reduce(into: [:]) { dict, pair in
                    if let key = Int(pair.key) { dict[key] = pair.value }
                }
            }
        } catch { /* use defaults */ }
        isLoading = false
    }

    private func save() async {
        isSaving = true
        let timeStr = String(format: "%02d:%02d", dinnerHour, dinnerMinute)
        let dayTypesStr = dayTypes.reduce(into: [String: String]()) { dict, pair in
            dict[String(pair.key)] = pair.value
        }
        let traditionsStr = traditions.reduce(into: [String: String]()) { dict, pair in
            dict[String(pair.key)] = pair.value
        }
        let req = UpdateSettingsRequest(
            dinnerTime: timeStr,
            proactiveEnabled: proactiveEnabled,
            proactiveVoice: proactiveVoice,
            householdName: householdName.trimmingCharacters(in: .whitespaces),
            householdSize: householdSize,
            country: country,
            dayTypes: dayTypesStr.isEmpty ? nil : dayTypesStr,
            staples: staples.isEmpty ? nil : staples,
            fishTarget: fishTarget,
            veggieTarget: veggieTarget,
            maxCookingTime: maxCookingTime,
            traditions: traditionsStr.isEmpty ? nil : traditionsStr
        )
        do {
            try await api.updateSettings(req)
            withAnimation { savedFeedback = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                withAnimation { savedFeedback = false }
            }
        } catch { /* silent */ }
        isSaving = false
    }
}
