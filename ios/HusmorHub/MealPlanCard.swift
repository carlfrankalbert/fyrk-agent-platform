import SwiftUI

struct MealPlanCard: View {
    let meals: MealsResponse?
    let shopping: ShoppingResponse?
    let onToggleItem: (String, Bool) -> Void
    let onAddItem: (String) -> Void
    let onRateMeal: (Int, String) -> Void

    private let dayNames = ["Man", "Tir", "Ons", "Tor", "Fre", "Lor", "Son"]
    private var today: Int { todayDayOfWeek() }
    @State private var ratedToday: String? = nil

    var body: some View {
        HStack(spacing: 0) {
            // Meal plan area
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Ukemeny")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(Theme.text)
                    Spacer()
                    if let plan = meals?.plan {
                        Text("Uke \(plan.weekNumber)")
                            .font(.system(size: 13))
                            .foregroundColor(Theme.muted)
                    }
                }

                if let plan = meals?.plan {
                    mealGrid(plan)
                } else {
                    emptyGrid
                }
            }
            .padding(Theme.cardPadding)

            // Shopping sidebar
            shoppingSidebar
        }
        .background(Theme.card)
        .cornerRadius(Theme.cardCorner)
    }

    private func mealGrid(_ plan: MealPlan) -> some View {
        HStack(spacing: 8) {
            ForEach(1...7, id: \.self) { day in
                let meal = plan.meals.first(where: { $0.dayOfWeek == day })
                let isToday = day == today
                let isPast = day < today

                VStack(spacing: 6) {
                    Text(dayNames[day - 1])
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(isToday ? Theme.accent : Theme.muted)

                    if let meal = meal {
                        Text(mealEmoji(for: meal.name))
                            .font(.system(size: isToday ? 28 : 22))

                        Text(meal.name)
                            .font(.system(size: isToday ? 14 : 12, weight: isToday ? .semibold : .regular))
                            .foregroundColor(isPast ? Theme.muted.opacity(0.5) : Theme.text)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)

                        if isToday, let desc = meal.description, !desc.isEmpty {
                            Text(desc)
                                .font(.system(size: 11))
                                .foregroundColor(Theme.muted)
                                .multilineTextAlignment(.center)
                                .lineLimit(3)
                        }

                        // Rating buttons for today
                        if isToday {
                            if let rated = ratedToday {
                                Text(rated)
                                    .font(.system(size: 20))
                            } else {
                                HStack(spacing: 12) {
                                    ratingButton("👍", meal: meal, emoji: "👍")
                                    ratingButton("👎", meal: meal, emoji: "👎")
                                }
                                .padding(.top, 4)
                            }
                        }
                    } else {
                        Text("\u{1F37D}\u{FE0F}")
                            .font(.system(size: isToday ? 28 : 22))
                            .opacity(0.3)
                        Text(isToday ? "Ingen middag" : "-")
                            .font(.system(size: 12))
                            .foregroundColor(Theme.muted.opacity(0.4))
                    }

                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .padding(.horizontal, 4)
                .background(isToday ? Theme.surface : Color.clear)
                .overlay(
                    Rectangle()
                        .fill(isToday ? Theme.accent : Color.clear)
                        .frame(height: 3),
                    alignment: .top
                )
                .cornerRadius(8)
                .opacity(isPast ? 0.5 : 1)
            }
        }
    }

    private func ratingButton(_ label: String, meal: Meal, emoji: String) -> some View {
        Button(action: {
            withAnimation(.easeInOut(duration: 0.3)) {
                ratedToday = emoji
            }
            onRateMeal(meal.dayOfWeek, emoji)
        }) {
            Text(label)
                .font(.system(size: 22))
                .padding(6)
                .background(Theme.surface)
                .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }

    private var emptyGrid: some View {
        HStack(spacing: 8) {
            ForEach(1...7, id: \.self) { day in
                let isToday = day == today
                VStack(spacing: 6) {
                    Text(dayNames[day - 1])
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(isToday ? Theme.accent : Theme.muted)
                    Text("\u{1F37D}\u{FE0F}")
                        .font(.system(size: 22))
                        .opacity(0.3)
                    Text(isToday ? "Ingen middag" : "-")
                        .font(.system(size: 12))
                        .foregroundColor(Theme.muted.opacity(0.4))
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(isToday ? Theme.surface : Color.clear)
                .overlay(
                    Rectangle()
                        .fill(isToday ? Theme.accent : Color.clear)
                        .frame(height: 3),
                    alignment: .top
                )
                .cornerRadius(8)
            }
        }
    }

    private var shoppingSidebar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "cart.fill")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.accent)
                Text("Handleliste")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.text)
                Spacer()
                if let s = shopping {
                    let remaining = s.items.filter { !$0.checked }.count
                    Text("\(remaining)")
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundColor(Theme.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Theme.accent.opacity(0.15))
                        .cornerRadius(10)
                }
            }

            Divider()
                .background(Theme.surface)

            if let s = shopping {
                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(s.items) { item in
                            ShoppingRow(item: item, onToggle: { checked in
                                onToggleItem(item.id, checked)
                            })
                        }
                    }
                }

                AddItemRow(onAdd: onAddItem)
            } else {
                Spacer()
                ProgressView()
                    .tint(Theme.muted)
                    .frame(maxWidth: .infinity)
                Spacer()
            }
        }
        .padding(12)
        .frame(width: 200)
        .background(Theme.surface.opacity(0.5))
    }
}

struct ShoppingRow: View {
    let item: ShoppingItem
    let onToggle: (Bool) -> Void

    var body: some View {
        Button(action: { onToggle(!item.checked) }) {
            HStack(spacing: 8) {
                Image(systemName: item.checked ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 16))
                    .foregroundColor(item.checked ? Theme.green : Theme.muted)

                Text(itemText)
                    .font(.system(size: 13))
                    .foregroundColor(item.checked ? Theme.muted.opacity(0.5) : Theme.text)
                    .strikethrough(item.checked, color: Theme.muted.opacity(0.3))
                    .lineLimit(1)

                Spacer()
            }
            .padding(.vertical, 4)
            .padding(.horizontal, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var itemText: String {
        var text = item.name
        if let amount = item.amount, let unit = item.unit {
            text += " (\(formatAmount(amount)) \(unit))"
        } else if let amount = item.amount {
            text += " (\(formatAmount(amount)))"
        }
        return text
    }

    private func formatAmount(_ a: Double) -> String {
        a.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(a)) : String(format: "%.1f", a)
    }
}

struct AddItemRow: View {
    let onAdd: (String) -> Void
    @State private var text = ""

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "plus.circle")
                .font(.system(size: 14))
                .foregroundColor(Theme.muted)

            TextField("", text: $text, prompt: Text("Legg til...").foregroundColor(Theme.muted.opacity(0.4)))
                .font(.system(size: 13))
                .foregroundColor(Theme.text)
                .textFieldStyle(.plain)
                .onSubmit {
                    let trimmed = text.trimmingCharacters(in: .whitespaces)
                    guard !trimmed.isEmpty else { return }
                    onAdd(trimmed)
                    text = ""
                }
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .background(Theme.surface)
        .cornerRadius(8)
    }
}
