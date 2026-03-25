import SwiftUI

struct TodayCard: View {
    let calendar: CalendarResponse?
    let reminders: RemindersResponse?
    let onAddReminder: (String, String) -> Void
    let onDeleteReminder: (String) -> Void

    @State private var showingAddReminder = false
    @State private var newTitle = ""
    @State private var newEmoji = "\u{1F4CC}"

    private let emojiOptions = ["\u{1F4CC}", "\u{1F392}", "\u{1F5D1}\u{FE0F}", "\u{1F511}", "\u{1F48A}", "\u{1F4E6}", "\u{1F9F9}", "\u{1F415}", "\u{1F4B3}", "\u{1F4DE}"]

    private var importantItems: [ImportantItem] {
        var items: [ImportantItem] = []

        if let cal = calendar {
            let now = Date()
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let fallback = ISO8601DateFormatter()
            fallback.formatOptions = [.withInternetDateTime]

            for event in cal.events where event.isNow && !event.allDay {
                items.append(ImportantItem(
                    icon: "circle.fill",
                    iconColor: Theme.green,
                    title: event.title,
                    subtitle: "N\u{00E5}",
                    priority: 0
                ))
                break
            }

            if items.isEmpty {
                let upcoming = cal.events.filter { event in
                    guard !event.allDay else { return false }
                    let date = formatter.date(from: event.startTime) ?? fallback.date(from: event.startTime)
                    return date.map { $0 > now } ?? false
                }
                if let next = upcoming.first {
                    items.append(ImportantItem(
                        icon: "clock.fill",
                        iconColor: Theme.accent,
                        title: next.title,
                        subtitle: next.timeString,
                        priority: 1
                    ))
                }
            }
        }

        if let r = reminders {
            for reminder in r.reminders.prefix(2) {
                items.append(ImportantItem(
                    icon: nil,
                    iconColor: nil,
                    title: reminder.title,
                    subtitle: nil,
                    priority: 2,
                    emoji: reminder.emoji,
                    reminderId: reminder.id
                ))
            }
        }

        return Array(items.prefix(3))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Header
            HStack {
                Text("Viktig n\u{00E5}")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(Theme.text)
                    .textCase(.uppercase)
                    .tracking(0.5)

                Spacer()

                Button(action: { withAnimation(.easeInOut(duration: 0.2)) { showingAddReminder.toggle() } }) {
                    Image(systemName: showingAddReminder ? "xmark" : "plus")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(Theme.muted)
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.plain)
            }

            if importantItems.isEmpty && !showingAddReminder {
                Text("Alt rolig")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            } else {
                VStack(spacing: 2) {
                    ForEach(importantItems) { item in
                        importantRow(item)
                    }
                }
            }

            if showingAddReminder {
                addReminderRow
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private func importantRow(_ item: ImportantItem) -> some View {
        HStack(spacing: 7) {
            if let emoji = item.emoji {
                Text(emoji)
                    .font(.system(size: 14))
                    .frame(width: 20)
            } else if let icon = item.icon, let color = item.iconColor {
                Image(systemName: icon)
                    .font(.system(size: 7))
                    .foregroundColor(color)
                    .frame(width: 20)
            }

            Text(item.title)
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(Theme.text)
                .lineLimit(1)

            if let sub = item.subtitle {
                Spacer(minLength: 4)
                Text(sub)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Theme.muted)
            }

            Spacer(minLength: 0)

            if let rid = item.reminderId {
                Button(action: { onDeleteReminder(rid) }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundColor(Theme.muted)
                        .frame(width: 20, height: 20)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 3)
        .padding(.horizontal, 4)
    }

    private var addReminderRow: some View {
        VStack(spacing: 4) {
            HStack(spacing: 3) {
                ForEach(emojiOptions, id: \.self) { emoji in
                    Button(action: { newEmoji = emoji }) {
                        Text(emoji)
                            .font(.system(size: 12))
                            .padding(2)
                            .background(newEmoji == emoji ? Theme.accent.opacity(0.3) : Color.clear)
                            .cornerRadius(4)
                    }
                    .buttonStyle(.plain)
                }
            }

            HStack(spacing: 4) {
                Text(newEmoji)
                    .font(.system(size: 12))

                TextField("", text: $newTitle, prompt: Text("P\u{00E5}minnelse...").foregroundColor(Theme.muted))
                    .font(.system(size: 12))
                    .foregroundColor(Theme.text)
                    .textFieldStyle(.plain)
                    .onSubmit { submitReminder() }

                Button(action: submitReminder) {
                    Image(systemName: "arrow.right.circle.fill")
                        .font(.system(size: 14))
                        .foregroundColor(newTitle.isEmpty ? Theme.muted : Theme.accent)
                }
                .buttonStyle(.plain)
                .disabled(newTitle.isEmpty)
            }
            .padding(6)
            .background(Theme.surface)
            .cornerRadius(6)
        }
    }

    private func submitReminder() {
        let trimmed = newTitle.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        onAddReminder(trimmed, newEmoji)
        newTitle = ""
        showingAddReminder = false
    }
}

private struct ImportantItem: Identifiable {
    let id = UUID()
    let icon: String?
    let iconColor: Color?
    let title: String
    let subtitle: String?
    let priority: Int
    var emoji: String? = nil
    var reminderId: String? = nil
}
