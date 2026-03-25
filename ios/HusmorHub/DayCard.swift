import SwiftUI

struct DayCard: View {
    let dayName: String
    let dateString: String?
    let contextLine: String?
    let busyness: String?
    let option: MealOption
    let alternativeCount: Int
    let currentIndex: Int
    let isRevealed: Bool
    let source: MealSource
    let isLocked: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Day header
            HStack(spacing: 4) {
                Text(dayName)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(Theme.accent)

                if isLocked {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 9))
                        .foregroundColor(Theme.yellow)
                }

                Spacer()

                if let date = dateString {
                    Text(date)
                        .font(.system(size: 10))
                        .foregroundColor(Theme.dimmed)
                }
            }
            .padding(.bottom, 6)

            if isRevealed {
                // Meal name — the main content
                HStack(spacing: 10) {
                    Text(mealEmoji(for: option.name))
                        .font(.system(size: 28))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(option.name)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(Theme.text)
                            .lineLimit(2)

                        // One-line reasoning
                        if let reasoning = option.reasoning, !reasoning.isEmpty {
                            Text(reasoning)
                                .font(.system(size: 11))
                                .foregroundColor(Theme.muted)
                                .lineLimit(1)
                        }
                    }
                }

                Spacer(minLength: 8)

                // Bottom row: context + cook time
                HStack(spacing: 8) {
                    if let ctx = contextLine, !ctx.isEmpty {
                        HStack(spacing: 3) {
                            if busyness == "travel" {
                                Image(systemName: "bolt.fill")
                                    .font(.system(size: 7))
                                    .foregroundColor(Theme.yellow)
                            }
                            Text(ctx)
                                .font(.system(size: 10))
                                .foregroundColor(busyness == "travel" ? Theme.yellow : Theme.dimmed)
                        }
                    }

                    Spacer()

                    if let cookTime = option.cookTimeMin {
                        HStack(spacing: 3) {
                            Image(systemName: "clock")
                                .font(.system(size: 8))
                                .foregroundColor(Theme.dimmed)
                            Text("\(cookTime) min")
                                .font(.system(size: 10))
                                .foregroundColor(Theme.dimmed)
                        }
                    }

                    // Alt indicator (subtle)
                    if alternativeCount > 1 {
                        Text("\(currentIndex + 1)/\(alternativeCount)")
                            .font(.system(size: 9, weight: .medium, design: .rounded))
                            .foregroundColor(Theme.dimmed)
                    }
                }
            } else {
                Spacer()
                HStack {
                    Spacer()
                    Text("?")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundColor(Theme.dimmed)
                    Spacer()
                }
                Spacer()
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .glassEffect(
            isLocked ? .regular.tint(Theme.yellow) : .regular,
            in: RoundedRectangle(cornerRadius: 12)
        )
    }
}

// MARK: - Safe array subscript

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
