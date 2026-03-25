import SwiftUI

struct MealPlanCard: View {
    let meals: MealsResponse?
    let shopping: ShoppingResponse?
    let dinnerTime: String  // "HH:mm" from settings
    let onShowGenerator: () -> Void
    let onShowRecipes: () -> Void

    private let dayNames = ["Man", "Tir", "Ons", "Tor", "Fre", "L\u{00F8}r", "S\u{00F8}n"]
    private let fullDayNames = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "L\u{00F8}rdag", "S\u{00F8}ndag"]
    private var today: Int { todayDayOfWeek() }

    private var todaysMeal: Meal? {
        meals?.plan?.meals.first(where: { $0.dayOfWeek == today })
    }

    private var isTodayAway: Bool {
        guard let meal = todaysMeal else { return false }
        return meal.mealType == "away" || meal.mealType == "leftovers" || meal.mealType == "takeaway"
    }

    private var nextCookingMeal: Meal? {
        guard let plan = meals?.plan else { return nil }
        return plan.meals
            .filter { $0.dayOfWeek > today && $0.mealType == "dinner" }
            .sorted(by: { $0.dayOfWeek < $1.dayOfWeek })
            .first
    }

    private var isTodayMealPast: Bool {
        let parts = dinnerTime.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return false }
        let cal = Calendar.current
        let now = Date()
        guard let dinnerDate = cal.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: now) else { return false }
        return now > dinnerDate.addingTimeInterval(2 * 3600)
    }

    private var heroMeal: Meal? {
        if isTodayMealPast, let next = nextCookingMeal { return next }
        return todaysMeal
    }

    private var heroLabel: String {
        guard let meal = heroMeal else { return "I DAG" }
        if meal.dayOfWeek == today { return "I DAG" }
        if meal.dayOfWeek == (today % 7) + 1 { return "I MORGEN" }
        return dayNames[meal.dayOfWeek - 1].uppercased()
    }

    private var isHeroAway: Bool {
        guard let meal = heroMeal else { return false }
        return meal.mealType == "away" || meal.mealType == "leftovers" || meal.mealType == "takeaway"
    }

    // MARK: - Body

    var body: some View {
        GeometryReader { geo in
            let showCompact = isHeroAway
            // Hero is tight — ukemeny owns the space
            let heroHeight: CGFloat = heroMeal != nil ? (showCompact ? 56 : min(180, geo.size.height * 0.30)) : 0
            let menuHeight: CGFloat = geo.size.height - heroHeight

            VStack(alignment: .leading, spacing: 0) {
                if let meal = heroMeal {
                    if showCompact {
                        compactHero(meal)
                            .frame(height: heroHeight)
                    } else {
                        todayHero(meal)
                            .frame(height: heroHeight)
                    }
                }

                weeklyMenu(availableHeight: menuHeight)
            }
        }
        .glassCard()
    }

    // MARK: - Compact hero (away/leftovers/takeaway)

    private func compactHero(_ meal: Meal) -> some View {
        HStack(spacing: 8) {
            Text(heroLabel)
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(Theme.dimmed)
                .tracking(1.2)

            Text(mealEmoji(for: meal.name))
                .font(.system(size: 18))

            Text(meal.mealType == "away" ? "Borte" : (meal.mealType == "leftovers" ? "Rester" : meal.name))
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(Theme.muted)

            Spacer()

            if let next = nextCookingMeal, next.dayOfWeek != meal.dayOfWeek {
                Text("\(dayNames[next.dayOfWeek - 1]): \(next.name)")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.dimmed)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface.opacity(0.1))
    }

    // MARK: - Hero (tight: name + action, no dead air)

    private func todayHero(_ meal: Meal) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            // Label
            Text(heroLabel)
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(Theme.accent)
                .tracking(1.2)

            // Title row: emoji + name + recipe action
            HStack(spacing: 12) {
                Text(mealEmoji(for: meal.name))
                    .font(.system(size: 40))

                VStack(alignment: .leading, spacing: 2) {
                    Text(meal.name)
                        .font(.system(size: 32, weight: .bold))
                        .foregroundColor(Theme.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)

                    if let desc = meal.description, !desc.isEmpty {
                        Text(desc)
                            .font(.system(size: 13))
                            .foregroundColor(Theme.muted)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 8)

                // Recipe button — belongs to this meal
                Button(action: onShowRecipes) {
                    HStack(spacing: 4) {
                        Image(systemName: "book").font(.system(size: 11))
                        Text("Oppskrift").font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundColor(Theme.accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Theme.accent.opacity(0.08))
                    .cornerRadius(8)
                }
                .buttonStyle(.plain)
            }

            // Start time — only for today, before dinner
            if meal.dayOfWeek == today && !isTodayMealPast {
                startTimeRow(cookMinutes: 30)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.surface.opacity(0.1))
    }

    // MARK: - Start time

    private func startTimeRow(cookMinutes: Int) -> some View {
        let startStr = startTimeString(cookMinutes: cookMinutes)
        let minsLeft = minutesUntilStart(cookMinutes: cookMinutes)
        let color = startTimeColor(minsLeft)

        return HStack(spacing: 5) {
            Image(systemName: "play.circle.fill")
                .font(.system(size: 12))
                .foregroundColor(color)
            Text("Start senest \(startStr)")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Theme.muted)
            if let mins = minsLeft, mins > 0, mins < 120 {
                Text("om \(mins) min")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(color)
            } else if let mins = minsLeft, mins <= 0 {
                Text("n\u{00E5}!")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(Theme.red)
            }
        }
    }

    private func startTimeString(cookMinutes: Int) -> String {
        let parts = dinnerTime.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return "--:--" }
        let totalMin = parts[0] * 60 + parts[1] - cookMinutes
        return String(format: "%02d:%02d", totalMin / 60, totalMin % 60)
    }

    private func minutesUntilStart(cookMinutes: Int) -> Int? {
        let parts = dinnerTime.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        let startTotalMin = parts[0] * 60 + parts[1] - cookMinutes
        guard let startDate = Calendar.current.date(bySettingHour: startTotalMin / 60, minute: startTotalMin % 60, second: 0, of: Date()) else { return nil }
        return Int(startDate.timeIntervalSince(Date()) / 60)
    }

    private func startTimeColor(_ minsLeft: Int?) -> Color {
        guard let mins = minsLeft else { return Theme.accent }
        if mins <= 0 { return Theme.red }
        if mins < 30 { return Theme.yellow }
        return Theme.green
    }

    // MARK: - Weekly menu (the main block)

    private func weeklyMenu(availableHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle()
                .fill(Theme.muted.opacity(0.08))
                .frame(height: 1)

            // Header
            HStack(spacing: 6) {
                Text("UKEMENY")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(Theme.muted)
                    .tracking(1)

                if let plan = meals?.plan {
                    Text("UKE \(plan.weekNumber)")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundColor(Theme.accent)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Theme.accent.opacity(0.08))
                        .cornerRadius(4)
                }

                Spacer()

                Button(action: onShowGenerator) {
                    HStack(spacing: 4) {
                        Image(systemName: "wand.and.stars").font(.system(size: 10))
                        Text("Ny meny").font(.system(size: 10, weight: .semibold))
                    }
                    .foregroundColor(Theme.accent)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 6)

            if let plan = meals?.plan, !plan.meals.isEmpty {
                ScrollView {
                    mealGrid(plan)
                        .padding(.horizontal, 10)
                }
            } else {
                emptyState
            }
        }
        .frame(height: availableHeight)
    }

    // MARK: - Grid (operative, rhythm-driven)

    private func mealGrid(_ plan: MealPlan) -> some View {
        VStack(spacing: 2) {
            ForEach(1...7, id: \.self) { day in
                let meal = plan.meals.first(where: { $0.dayOfWeek == day })
                let isToday = day == today
                let isPast = day < today || (isToday && isTodayMealPast)
                let isFuture = !isToday && !isPast

                HStack(spacing: 0) {
                    // Day name column
                    Text(dayNames[day - 1])
                        .font(.system(size: isToday && !isPast ? 14 : 13, weight: isToday && !isPast ? .bold : .medium, design: .rounded))
                        .foregroundColor(isPast ? Theme.dimmed : (isToday ? Theme.accent : Theme.text))
                        .frame(width: 36, alignment: .leading)

                    // Emoji
                    if let meal = meal {
                        Text(mealGridEmoji(meal))
                            .font(.system(size: isPast ? 13 : 16))
                            .frame(width: 28)
                    } else {
                        Text(" ")
                            .font(.system(size: 16))
                            .frame(width: 28)
                    }

                    // Meal name
                    if let meal = meal {
                        mealGridLabel(meal, isToday: isToday, isPast: isPast)
                    } else {
                        Text("Ikke planlagt")
                            .font(.system(size: 12))
                            .foregroundColor(Theme.dimmed)
                            .italic()
                    }

                    Spacer(minLength: 4)

                    // Status indicator for future days
                    if isFuture, let meal = meal {
                        mealStatusBadge(meal)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, isToday && !isPast ? 12 : 9)
                .background(isToday && !isPast ? Theme.accent.opacity(0.06) : Color.clear)
                .cornerRadius(8)
            }
        }
    }

    /// Small status for future meals — shopping readiness
    private func mealStatusBadge(_ meal: Meal) -> some View {
        Group {
            if meal.mealType == "away" || meal.mealType == "leftovers" || meal.mealType == "takeaway" {
                EmptyView()
            } else if let shop = shopping {
                let unchecked = shop.items.filter { !$0.checked }
                if unchecked.isEmpty {
                    // No items at all — no badge
                    EmptyView()
                } else {
                    let mealWords = Set(meal.name.lowercased().split(separator: " ").map(String.init).filter { $0.count > 2 })
                    let missing = unchecked.contains { item in
                        item.name.lowercased().split(separator: " ").map(String.init).contains { mealWords.contains($0) }
                    }
                    if missing {
                        Circle()
                            .fill(Theme.yellow)
                            .frame(width: 5, height: 5)
                            .padding(.trailing, 4)
                    }
                }
            }
        }
    }

    private func mealGridEmoji(_ meal: Meal) -> String {
        switch meal.mealType {
        case "away": return "\u{2708}\u{FE0F}"
        case "leftovers": return "\u{1F372}"
        case "takeaway": return "\u{1F961}"
        default: return mealEmoji(for: meal.name)
        }
    }

    private func mealGridLabel(_ meal: Meal, isToday: Bool, isPast: Bool) -> some View {
        let color = isPast ? Theme.dimmed : (isToday ? Theme.text : Theme.muted)

        return Group {
            switch meal.mealType {
            case "away":
                Text("Borte")
                    .font(.system(size: isToday ? 14 : 13, weight: .regular))
                    .foregroundColor(isPast ? Theme.dimmed : Theme.muted)
                    .italic()
            case "leftovers":
                Text("Rester")
                    .font(.system(size: isToday ? 14 : 13, weight: .regular))
                    .foregroundColor(isPast ? Theme.dimmed : Theme.muted)
                    .italic()
            default:
                Text(meal.name)
                    .font(.system(size: isToday && !isPast ? 15 : 13, weight: isToday && !isPast ? .semibold : .regular))
                    .foregroundColor(color)
                    .lineLimit(1)
            }
        }
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 16) {
            Spacer()
            HStack {
                Spacer()
                VStack(spacing: 12) {
                    Text("\u{1F37D}\u{FE0F}")
                        .font(.system(size: 40))
                    Text("Ingen ukemeny enn\u{00E5}")
                        .font(.system(size: 15))
                        .foregroundColor(Theme.muted)
                    Button(action: onShowGenerator) {
                        HStack(spacing: 6) {
                            Image(systemName: "wand.and.stars").font(.system(size: 14))
                            Text("Lag ukemeny").font(.system(size: 15, weight: .semibold))
                        }
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Theme.accent)
                        .cornerRadius(12)
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
            }
            Spacer()
        }
    }
}
