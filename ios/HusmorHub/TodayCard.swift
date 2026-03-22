import SwiftUI

struct TodayCard: View {
    let calendar: CalendarResponse?
    let reminders: RemindersResponse?
    let onAddReminder: (String, String) -> Void
    let onDeleteReminder: (String) -> Void

    @State private var showingAddReminder = false
    @State private var newTitle = ""
    @State private var newEmoji = "📌"

    private var dateNumber: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "d"
        return formatter.string(from: Date())
    }

    private var dayName: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "nb_NO")
        formatter.dateFormat = "EEEE"
        return formatter.string(from: Date()).capitalized
    }

    private var fullDate: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "nb_NO")
        formatter.dateFormat = "d. MMMM"
        return formatter.string(from: Date())
    }

    private var todayEvents: [CalendarEvent] {
        guard let cal = calendar else { return [] }
        let todayStr = {
            let f = DateFormatter()
            f.dateFormat = "yyyy-MM-dd"
            return f.string(from: Date())
        }()
        return cal.events.filter { $0.startTime.hasPrefix(todayStr) || $0.allDay }
    }

    private let emojiOptions = ["📌", "🎒", "🗑️", "🔑", "💊", "📦", "🧹", "🐕", "💳", "📞"]

    var body: some View {
        CardContainer(title: "I dag") {
            VStack(alignment: .leading, spacing: 10) {
                // Date display
                HStack(spacing: 12) {
                    Text(dateNumber)
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .foregroundColor(Theme.text)
                        .frame(width: 44, height: 44)
                        .background(Theme.accent)
                        .cornerRadius(10)

                    VStack(alignment: .leading, spacing: 1) {
                        Text(dayName)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(Theme.text)
                        Text(fullDate)
                            .font(.system(size: 13))
                            .foregroundColor(Theme.muted)
                    }
                }

                Divider().background(Theme.surface)

                // Calendar events
                if !todayEvents.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        sectionHeader("Kalender")
                        ForEach(todayEvents.prefix(4)) { event in
                            eventRow(event)
                        }
                    }
                }

                Spacer(minLength: 2)

                // Reminders — prominent
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Husk i dag")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(Theme.text)
                        Spacer()
                        Button(action: { showingAddReminder.toggle() }) {
                            Image(systemName: showingAddReminder ? "xmark.circle.fill" : "plus.circle.fill")
                                .font(.system(size: 18))
                                .foregroundColor(Theme.accent)
                        }
                        .buttonStyle(.plain)
                    }

                    if let r = reminders, !r.reminders.isEmpty {
                        ForEach(r.reminders) { reminder in
                            HStack(spacing: 10) {
                                Text(reminder.emoji)
                                    .font(.system(size: 20))
                                Text(reminder.title)
                                    .font(.system(size: 16))
                                    .foregroundColor(Theme.text)
                                Spacer()
                                Button(action: { onDeleteReminder(reminder.id) }) {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 11, weight: .bold))
                                        .foregroundColor(Theme.muted.opacity(0.4))
                                }
                                .buttonStyle(.plain)
                            }
                            .padding(.vertical, 4)
                        }
                    }

                    if showingAddReminder {
                        addReminderRow
                    }
                }
            }
        }
    }

    private var addReminderRow: some View {
        VStack(spacing: 8) {
            // Emoji picker
            HStack(spacing: 6) {
                ForEach(emojiOptions, id: \.self) { emoji in
                    Button(action: { newEmoji = emoji }) {
                        Text(emoji)
                            .font(.system(size: 16))
                            .padding(4)
                            .background(newEmoji == emoji ? Theme.accent.opacity(0.3) : Color.clear)
                            .cornerRadius(6)
                    }
                    .buttonStyle(.plain)
                }
            }

            HStack(spacing: 6) {
                Text(newEmoji)
                    .font(.system(size: 14))

                TextField("", text: $newTitle, prompt: Text("Ny påminnelse...").foregroundColor(Theme.muted.opacity(0.4)))
                    .font(.system(size: 13))
                    .foregroundColor(Theme.text)
                    .textFieldStyle(.plain)
                    .onSubmit { submitReminder() }

                Button(action: submitReminder) {
                    Image(systemName: "arrow.right.circle.fill")
                        .font(.system(size: 18))
                        .foregroundColor(newTitle.isEmpty ? Theme.muted.opacity(0.3) : Theme.accent)
                }
                .buttonStyle(.plain)
                .disabled(newTitle.isEmpty)
            }
            .padding(8)
            .background(Theme.surface)
            .cornerRadius(8)
        }
    }

    private func submitReminder() {
        let trimmed = newTitle.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        onAddReminder(trimmed, newEmoji)
        newTitle = ""
        showingAddReminder = false
    }

    private func sectionHeader(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .medium))
            .foregroundColor(Theme.muted)
            .textCase(.uppercase)
            .tracking(0.5)
    }

    private func eventRow(_ event: CalendarEvent) -> some View {
        HStack(spacing: 8) {
            Text(event.allDay ? "●" : event.timeString)
                .font(.system(size: 12, weight: event.isNow ? .bold : .regular, design: .monospaced))
                .foregroundColor(event.isNow ? Theme.accent : Theme.muted)
                .frame(width: 44, alignment: .leading)

            Text(event.title)
                .font(.system(size: 13, weight: event.isNow ? .medium : .regular))
                .foregroundColor(event.isNow ? Theme.text : Theme.text.opacity(0.8))
                .lineLimit(1)
        }
    }
}
