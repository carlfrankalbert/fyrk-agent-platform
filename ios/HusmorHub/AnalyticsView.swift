import SwiftUI

struct AnalyticsView: View {
    @ObservedObject var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var summary: AnalyticsSummary?
    @State private var isLoading = true

    // Feature display names
    private let featureNames: [String: (name: String, icon: String)] = [
        "dashboard":         ("Dashboard",          "rectangle.grid.2x2"),
        "voice":             ("Stemme",             "mic.fill"),
        "meal_rating":       ("Middagsvurdering",   "hand.thumbsup.fill"),
        "meal_generator":    ("Menyplanlegger",     "wand.and.stars"),
        "recipes":           ("Oppskrifter",        "book.fill"),
        "shopping_toggle":   ("Handleliste: sjekk", "checkmark.circle"),
        "shopping_add":      ("Handleliste: legg til", "plus.circle"),
        "oda_sync":          ("Oda-sync",           "bag.fill"),
        "oda_remove":        ("Oda: fjern",         "bag.badge.minus"),
        "reminder_add":      ("Påminnelse: legg til", "bell.badge.fill"),
        "reminder_delete":   ("Påminnelse: slett",  "bell.slash.fill"),
        "proactive_message": ("Proaktiv melding",   "bubble.left.fill"),
        "settings":          ("Innstillinger",      "gearshape.fill"),
    ]

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                // Header
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Bruksanalyse")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(Theme.text)
                        Text("Siste 30 dager")
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
                .padding(24)

                if isLoading {
                    Spacer()
                    ProgressView().tint(Theme.accent)
                        .frame(maxWidth: .infinity)
                    Spacer()
                } else if let summary = summary {
                    ScrollView {
                        VStack(spacing: 0) {
                            // Heat map header
                            heatMapHeader(summary)
                                .padding(.horizontal, 24)
                                .padding(.bottom, 16)

                            // Feature list
                            ForEach(summary.features) { feature in
                                featureRow(feature, maxTotal: summary.features.first?.total ?? 1)
                            }
                        }
                    }
                } else {
                    Spacer()
                    VStack(spacing: 12) {
                        Image(systemName: "chart.bar.xaxis")
                            .font(.system(size: 36))
                            .foregroundColor(Theme.muted)
                        Text("Ingen data ennå")
                            .font(.system(size: 15))
                            .foregroundColor(Theme.muted)
                        Text("Bruk appen noen dager, så dukker det opp her.")
                            .font(.system(size: 13))
                            .foregroundColor(Theme.muted)
                    }
                    .frame(maxWidth: .infinity)
                    Spacer()
                }
            }
        }
        .task { await load() }
    }

    // MARK: - Heat map summary

    private func heatMapHeader(_ summary: AnalyticsSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Oversikt")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Theme.muted)
                .textCase(.uppercase)
                .tracking(1)

            // Collect all days and build a day grid
            let allDays = collectDays(summary)
            if !allDays.isEmpty {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: min(allDays.count, 14)), spacing: 3) {
                    ForEach(allDays, id: \.day) { entry in
                        VStack(spacing: 2) {
                            RoundedRectangle(cornerRadius: 3)
                                .fill(heatColor(entry.count, max: allDays.map(\.count).max() ?? 1))
                                .frame(height: 24)
                            Text(dayLabel(entry.day))
                                .font(.system(size: 8))
                                .foregroundColor(Theme.muted)
                        }
                    }
                }
            }

            // Total events
            let totalEvents = summary.features.reduce(0) { $0 + $1.total }
            let activeFeatures = summary.features.filter { $0.total > 0 }.count
            HStack(spacing: 16) {
                statPill("\(totalEvents)", label: "hendelser")
                statPill("\(activeFeatures)", label: "aktive features")
                statPill("\(summary.features.count - activeFeatures)", label: "ubrukte")
            }
            .padding(.top, 4)
        }
        .padding(16)
        .background(Theme.card)
        .cornerRadius(12)
    }

    private func statPill(_ value: String, label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .foregroundColor(Theme.text)
            Text(label)
                .font(.system(size: 10))
                .foregroundColor(Theme.muted)
        }
    }

    // MARK: - Feature rows

    private func featureRow(_ feature: FeatureUsage, maxTotal: Int) -> some View {
        let info = featureNames[feature.feature] ?? (name: feature.feature, icon: "questionmark.circle")
        let barWidth = maxTotal > 0 ? CGFloat(feature.total) / CGFloat(maxTotal) : 0

        return HStack(spacing: 12) {
            Image(systemName: info.icon)
                .font(.system(size: 14))
                .foregroundColor(barWidth > 0.3 ? Theme.accent : Theme.muted)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 3) {
                Text(info.name)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Theme.text)

                // Bar
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Theme.surface)
                            .frame(height: 6)

                        RoundedRectangle(cornerRadius: 2)
                            .fill(barColor(barWidth))
                            .frame(width: max(2, geo.size.width * barWidth), height: 6)
                    }
                }
                .frame(height: 6)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 1) {
                Text("\(feature.total)")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundColor(feature.total > 0 ? Theme.text : Theme.muted)

                Text(relativeDate(feature.lastUsed))
                    .font(.system(size: 10))
                    .foregroundColor(Theme.muted)
            }
            .frame(width: 70, alignment: .trailing)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 10)
    }

    // MARK: - Helpers

    private struct DayEntry {
        let day: String
        let count: Int
    }

    private func collectDays(_ summary: AnalyticsSummary) -> [DayEntry] {
        var dayCounts: [String: Int] = [:]
        for feature in summary.features {
            for (day, count) in feature.byDay {
                dayCounts[day, default: 0] += count
            }
        }
        return dayCounts
            .map { DayEntry(day: $0.key, count: $0.value) }
            .sorted { $0.day < $1.day }
            .suffix(14)
            .map { $0 }
    }

    private func heatColor(_ count: Int, max: Int) -> Color {
        guard max > 0 else { return Theme.surface }
        let intensity = Double(count) / Double(max)
        if intensity < 0.1 { return Theme.surface }
        if intensity < 0.3 { return Theme.accent.opacity(0.2) }
        if intensity < 0.6 { return Theme.accent.opacity(0.4) }
        return Theme.accent.opacity(0.7)
    }

    private func barColor(_ ratio: CGFloat) -> Color {
        if ratio < 0.05 { return Theme.red.opacity(0.6) }
        if ratio < 0.15 { return Theme.yellow }
        return Theme.accent
    }

    private func dayLabel(_ day: String) -> String {
        // day is "YYYY-MM-DD" — return "DD"
        String(day.suffix(2))
    }

    private func relativeDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) else { return "" }
        let days = Calendar.current.dateComponents([.day], from: date, to: Date()).day ?? 0
        if days == 0 { return "i dag" }
        if days == 1 { return "i går" }
        return "\(days)d siden"
    }

    private func load() async {
        do {
            summary = try await api.fetchAnalytics()
        } catch { /* silent */ }
        isLoading = false
    }
}
