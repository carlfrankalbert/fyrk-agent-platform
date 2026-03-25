import SwiftUI

struct RecipeListView: View {
    @ObservedObject var api: APIClient
    @State private var recipes: [RecipeSummary] = []
    @State private var selectedRecipe: RecipeDetailResponse?
    @State private var isLoading = true
    @State private var loadError = false

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            if isLoading {
                ProgressView()
                    .tint(Theme.accent)
            } else if loadError {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 36))
                        .foregroundColor(Theme.yellow)
                    Text("Kunne ikke laste oppskrifter")
                        .font(.system(size: 15))
                        .foregroundColor(Theme.muted)
                    Button("Prøv igjen") {
                        isLoading = true
                        loadError = false
                        Task { await load() }
                    }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Theme.accent)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Theme.accent.opacity(0.15))
                    .cornerRadius(8)
                    .buttonStyle(.plain)
                }
            } else if recipes.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "book.closed")
                        .font(.system(size: 36))
                        .foregroundColor(Theme.muted)
                    Text("Ingen oppskrifter ennå")
                        .font(.system(size: 15))
                        .foregroundColor(Theme.muted)
                }
            } else {
                ScrollView {
                    LazyVGrid(columns: [
                        GridItem(.flexible(), spacing: 10),
                        GridItem(.flexible(), spacing: 10),
                        GridItem(.flexible(), spacing: 10),
                    ], spacing: 10) {
                        ForEach(recipes) { recipe in
                            RecipeCard(recipe: recipe)
                                .onTapGesture { loadRecipe(recipe.id) }
                        }
                    }
                    .padding(16)
                }
            }
        }
        .task { await load() }
        .sheet(item: $selectedRecipe) { detail in
            RecipeDetailView(detail: detail)
        }
    }

    private func load() async {
        do {
            let response = try await api.fetchRecipes()
            recipes = response.recipes
        } catch {
            loadError = true
        }
        isLoading = false
    }

    private func loadRecipe(_ id: String) {
        Task {
            do {
                selectedRecipe = try await api.fetchRecipe(id: id)
            } catch { /* silent — user can tap again */ }
        }
    }
}

struct RecipeCard: View {
    let recipe: RecipeSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(mealEmoji(for: recipe.name))
                .font(.system(size: 28))

            Text(recipe.name)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Theme.text)
                .lineLimit(2)

            if let desc = recipe.description {
                Text(desc)
                    .font(.system(size: 11))
                    .foregroundColor(Theme.muted)
                    .lineLimit(2)
            }

            Spacer(minLength: 0)

            HStack(spacing: 8) {
                if let prep = recipe.prepTimeMin {
                    Label("\(prep)m", systemImage: "clock")
                        .font(.system(size: 10))
                        .foregroundColor(Theme.muted)
                }
                if let tags = recipe.tags, !tags.isEmpty {
                    Text(tags.first ?? "")
                        .font(.system(size: 10))
                        .foregroundColor(Theme.accent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Theme.accent.opacity(0.1))
                        .cornerRadius(4)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
        .background(Theme.card)
        .cornerRadius(12)
    }
}

// MARK: - Recipe Detail

extension RecipeDetailResponse: Identifiable {
    var id: String { recipe.id }
}

struct RecipeDetailView: View {
    let detail: RecipeDetailResponse

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(detail.recipe.name)
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(Theme.text)

                        if let desc = detail.recipe.description {
                            Text(desc)
                                .font(.system(size: 14))
                                .foregroundColor(Theme.muted)
                        }
                    }

                    Spacer()

                    Button(action: { dismiss() }) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 24))
                            .foregroundColor(Theme.muted)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 8)

                // Meta badges
                HStack(spacing: 12) {
                    if let prep = detail.recipe.prepTimeMin {
                        metaBadge(icon: "knife", text: "\(prep) min forb.")
                    }
                    if let cook = detail.recipe.cookTimeMin {
                        metaBadge(icon: "flame", text: "\(cook) min tilb.")
                    }
                    if let servings = detail.recipe.servings {
                        metaBadge(icon: "person.2", text: "\(servings) porsjoner")
                    }
                    if let nutrition = detail.recipe.nutritionPerServing, let cal = nutrition.calories {
                        metaBadge(icon: "bolt", text: "\(Int(cal)) kcal")
                    }

                    if let tags = detail.recipe.tags {
                        ForEach(tags, id: \.self) { tag in
                            Text(tag)
                                .font(.system(size: 11))
                                .foregroundColor(Theme.accent)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Theme.accent.opacity(0.1))
                                .cornerRadius(6)
                        }
                    }

                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 12)

                // Content: ingredients + steps side by side
                HStack(alignment: .top, spacing: 16) {
                    // Ingredients
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Ingredienser")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(Theme.text)

                        ingredientsList
                    }
                    .frame(width: 260)

                    Divider()
                        .background(Theme.surface)

                    // Steps
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Fremgangsmate")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(Theme.text)

                        stepsList
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 16)

                Spacer(minLength: 0)
            }
        }
        .preferredColorScheme(.dark)
    }

    private var ingredientsList: some View {
        let grouped = Dictionary(grouping: detail.ingredients) { $0.ingredientGroup ?? "" }
        let groups = grouped.keys.sorted()

        return ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(groups, id: \.self) { group in
                    if !group.isEmpty {
                        Text(group.capitalized)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(Theme.accent)
                            .padding(.top, 6)
                    }
                    ForEach(grouped[group] ?? []) { ing in
                        HStack(spacing: 6) {
                            if let amount = ing.amount {
                                Text(formatAmount(amount) + (ing.unit.map { " \($0)" } ?? ""))
                                    .font(.system(size: 13, weight: .medium, design: .rounded))
                                    .foregroundColor(Theme.accent)
                                    .frame(width: 60, alignment: .trailing)
                            } else {
                                Spacer()
                                    .frame(width: 60)
                            }
                            Text(ing.name)
                                .font(.system(size: 14))
                                .foregroundColor(Theme.text)
                        }
                        .padding(.vertical, 3)
                    }
                }
            }
        }
    }

    private var stepsList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(detail.steps) { step in
                    HStack(alignment: .top, spacing: 10) {
                        Text("\(step.stepNumber)")
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundColor(Theme.accent)
                            .frame(width: 24, height: 24)
                            .background(Theme.accent.opacity(0.15))
                            .cornerRadius(12)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(step.instruction)
                                .font(.system(size: 14))
                                .foregroundColor(Theme.text)

                            if let dur = step.durationMin {
                                Text("\(dur) min")
                                    .font(.system(size: 11))
                                    .foregroundColor(Theme.muted)
                            }
                        }
                    }
                }
            }
        }
    }

    private func metaBadge(icon: String, text: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 11))
            Text(text)
                .font(.system(size: 12))
        }
        .foregroundColor(Theme.muted)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Theme.surface)
        .cornerRadius(6)
    }

    private func formatAmount(_ a: Double) -> String {
        a.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(a)) : String(format: "%.1f", a)
    }
}
