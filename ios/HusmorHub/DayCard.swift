import SwiftUI

struct DayCard: View {
    let dayName: String
    let dateString: String?     // "24. mars"
    let contextLine: String?    // "Henting 17:00"
    let busyness: String?       // "rolig", "normal", "travel"
    let option: MealOption
    let alternativeCount: Int
    let currentIndex: Int
    let isRevealed: Bool
    let source: MealSource
    let isLocked: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Day header: name + date
            VStack(spacing: 2) {
                HStack(spacing: 4) {
                    Text(dayName)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(Theme.accent)

                    if isLocked {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 9))
                            .foregroundColor(Theme.yellow)
                    }
                }

                if let date = dateString {
                    Text(date)
                        .font(.system(size: 10))
                        .foregroundColor(Theme.muted.opacity(0.6))
                }
            }
            .padding(.top, 10)
            .padding(.bottom, 4)

            // Context line — busyness-aware
            if let ctx = contextLine, !ctx.isEmpty, isRevealed {
                HStack(spacing: 3) {
                    if busyness == "travel" {
                        Image(systemName: "bolt.fill")
                            .font(.system(size: 8))
                            .foregroundColor(Theme.yellow)
                    }
                    Text(ctx)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(busyness == "travel" ? Theme.yellow : Theme.muted.opacity(0.5))
                }
                .padding(.bottom, 4)
            }

            if isRevealed {
                // Category badge
                if let cat = option.category, !cat.isEmpty {
                    categoryBadge(cat)
                        .padding(.bottom, 4)
                }

                // Emoji
                Text(mealEmoji(for: option.name))
                    .font(.system(size: 28))
                    .transition(.scale.combined(with: .opacity))
                    .padding(.bottom, 4)

                // Name
                Text(option.name)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Theme.text)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 5)

                // Reasoning
                if let reasoning = option.reasoning, !reasoning.isEmpty {
                    Text(reasoning)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(Theme.accent.opacity(0.7))
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .padding(.horizontal, 5)
                        .padding(.top, 2)
                }

                // Description
                if let desc = option.description, !desc.isEmpty {
                    Text(desc)
                        .font(.system(size: 10))
                        .foregroundColor(Theme.muted.opacity(0.6))
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                        .padding(.horizontal, 5)
                        .padding(.top, 2)
                }

                Spacer(minLength: 0)

                // Plan B for busy days
                if let planB = option.planB, !planB.isEmpty, busyness == "travel" {
                    HStack(spacing: 3) {
                        Text("B:")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundColor(Theme.yellow.opacity(0.6))
                        Text(planB)
                            .font(.system(size: 9))
                            .foregroundColor(Theme.yellow.opacity(0.5))
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(Theme.yellow.opacity(0.06))
                    .cornerRadius(4)
                    .padding(.bottom, 4)
                }

                // Source badge + alternative dots
                HStack(spacing: 6) {
                    sourceBadge
                    if alternativeCount > 1 {
                        HStack(spacing: 3) {
                            ForEach(0..<alternativeCount, id: \.self) { i in
                                Circle()
                                    .fill(i == currentIndex ? Theme.accent : Theme.muted.opacity(0.3))
                                    .frame(width: 5, height: 5)
                            }
                        }
                    }
                }
                .padding(.bottom, 8)
            } else {
                Spacer()
                Text("?")
                    .font(.system(size: 36, weight: .bold))
                    .foregroundColor(Theme.muted.opacity(0.3))
                Spacer()
            }
        }
        .padding(.horizontal, 3)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .glassEffect(
            isLocked ? .regular.tint(Theme.yellow) : .regular,
            in: RoundedRectangle(cornerRadius: 12)
        )
    }

    @ViewBuilder
    private var sourceBadge: some View {
        switch source {
        case .husmor:
            Image(systemName: "sparkles")
                .font(.system(size: 8))
                .foregroundColor(Theme.accent.opacity(0.5))
        case .user:
            Image(systemName: "person.fill")
                .font(.system(size: 8))
                .foregroundColor(Theme.green.opacity(0.5))
        case .locked:
            Image(systemName: "lock.fill")
                .font(.system(size: 8))
                .foregroundColor(Theme.yellow.opacity(0.5))
        case .notDecided:
            EmptyView()
        }
    }

    private func categoryBadge(_ category: String) -> some View {
        let (label, color) = categoryDisplay(category)
        return Text(label)
            .font(.system(size: 9, weight: .bold))
            .foregroundColor(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.12))
            .cornerRadius(4)
    }

    private func categoryDisplay(_ category: String) -> (String, Color) {
        switch category.lowercased() {
        case "fisk":
            return ("FISK", Color(red: 0.3, green: 0.7, blue: 0.9))
        case "kj\u{00F8}tt":
            return ("KJ\u{00D8}TT", Color(red: 0.85, green: 0.35, blue: 0.35))
        case "fj\u{00E6}rkre":
            return ("FJ\u{00C6}RKRE", Color(red: 0.9, green: 0.65, blue: 0.3))
        case "vegetar":
            return ("VEGETAR", Theme.green)
        case "vegan":
            return ("VEGAN", Color(red: 0.4, green: 0.8, blue: 0.4))
        case "belgvekst":
            return ("BELGVEKST", Color(red: 0.7, green: 0.6, blue: 0.3))
        default:
            return (category.uppercased(), Theme.muted)
        }
    }
}

// MARK: - Safe array subscript

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
