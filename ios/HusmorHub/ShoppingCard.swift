import SwiftUI

struct ShoppingCard: View {
    let meals: MealsResponse?
    let shopping: ShoppingResponse?
    let odaCart: OdaCart?
    let onToggleItem: (String, Bool) -> Void
    let onAddItem: (String) -> Void
    let onDeleteChecked: () -> Void
    let onSyncOda: ([String]?) -> Void
    let onRemoveOdaItem: (Int) -> Void
    var isSyncingOda: Bool = false

    @State private var showOdaCart = false
    @State private var showChecked = false
    private var today: Int { todayDayOfWeek() }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack(spacing: 6) {
                Image(systemName: showOdaCart ? "bag.fill" : "cart.fill")
                    .font(.system(size: 12))
                    .foregroundColor(showOdaCart ? Color.green : Theme.accent)
                Text(showOdaCart ? "Oda-kurv" : "Handleliste")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Theme.text)

                Spacer()

                Button(action: { withAnimation(.easeInOut(duration: 0.2)) { showOdaCart.toggle() } }) {
                    Image(systemName: showOdaCart ? "list.bullet" : "bag")
                        .font(.system(size: 11))
                        .foregroundColor(Theme.muted)
                        .padding(6)
                        .background(Theme.surface)
                        .cornerRadius(6)
                }
                .buttonStyle(.plain)
            }

            Divider().background(Theme.surface.opacity(0.5))

            if showOdaCart {
                odaCartView
            } else {
                shoppingListView
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    // MARK: - Shopping list

    private func splitShoppingItems(_ items: [ShoppingItem]) -> (forMeals: [ShoppingItem], other: [ShoppingItem]) {
        guard let plan = meals?.plan else { return ([], items) }

        let upcomingMeals = plan.meals.filter { $0.dayOfWeek >= today }
        var mealWords = Set<String>()
        for meal in upcomingMeals {
            for word in meal.name.lowercased().split(separator: " ") {
                if word.count > 2 { mealWords.insert(String(word)) }
            }
            if let desc = meal.description {
                for word in desc.lowercased().split(separator: " ") {
                    if word.count > 2 { mealWords.insert(String(word)) }
                }
            }
        }

        var forMeals: [ShoppingItem] = []
        var other: [ShoppingItem] = []
        for item in items {
            let itemWords = item.name.lowercased().split(separator: " ").map(String.init)
            if itemWords.contains(where: { mealWords.contains($0) }) {
                forMeals.append(item)
            } else {
                other.append(item)
            }
        }
        return (forMeals, other)
    }

    private var shoppingListView: some View {
        Group {
            if let s = shopping {
                let uncheckedItems = s.items.filter { !$0.checked }
                let checked = s.items.filter { $0.checked }

                if uncheckedItems.isEmpty && checked.isEmpty {
                    // Empty state — calm, intentional
                    shoppingEmptyState
                } else {
                    ScrollView {
                        let split = splitShoppingItems(uncheckedItems)

                        VStack(spacing: 2) {
                            if !split.forMeals.isEmpty {
                                sectionHeader("Til ukemenyen", color: Theme.accent)
                                ForEach(split.forMeals) { item in
                                    shoppingRow(item)
                                }
                            }

                            if !split.other.isEmpty {
                                if !split.forMeals.isEmpty {
                                    sectionHeader("Annet", color: Theme.muted)
                                        .padding(.top, 6)
                                }
                                ForEach(split.other) { item in
                                    shoppingRow(item)
                                }
                            }

                            if uncheckedItems.isEmpty && !checked.isEmpty {
                                // All items checked — show empty state inline
                                shoppingEmptyState
                                    .padding(.bottom, 8)
                            }

                            if !checked.isEmpty {
                                Button(action: { withAnimation(.easeInOut(duration: 0.2)) { showChecked.toggle() } }) {
                                    HStack {
                                        sectionHeader("Handlet (\(checked.count))", color: Theme.dimmed)
                                        Image(systemName: showChecked ? "chevron.up" : "chevron.down")
                                            .font(.system(size: 8))
                                            .foregroundColor(Theme.dimmed)
                                        Spacer()
                                    }
                                }
                                .buttonStyle(.plain)
                                .padding(.top, 6)

                                if showChecked {
                                    HStack {
                                        Spacer()
                                        Button(action: { clearChecked(checked) }) {
                                            Text("Fjern alle")
                                                .font(.system(size: 10, weight: .medium))
                                                .foregroundColor(Theme.red)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                    ForEach(checked) { item in
                                        shoppingRow(item)
                                    }
                                }
                            }
                        }
                    }
                }

                AddItemRow(onAdd: onAddItem)

                let unchecked = uncheckedItems.count
                if unchecked > 0 {
                    Button(action: { onSyncOda(nil) }) {
                        HStack(spacing: 5) {
                            if isSyncingOda {
                                ProgressView().scaleEffect(0.5).tint(Color.green)
                            } else {
                                Image(systemName: "bag.badge.plus")
                                    .font(.system(size: 11))
                            }
                            Text(isSyncingOda ? "Sender..." : "Send \(unchecked) til Oda")
                                .font(.system(size: 11, weight: .medium))
                        }
                        .foregroundColor(Color.green)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .background(Color.green.opacity(0.1))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .strokeBorder(Color.green.opacity(0.25), lineWidth: 1)
                        )
                        .cornerRadius(8)
                    }
                    .buttonStyle(.plain)
                    .disabled(isSyncingOda)
                }
            } else {
                Spacer()
                ProgressView().tint(Theme.muted).frame(maxWidth: .infinity)
                Spacer()
            }
        }
    }

    private var shoppingEmptyState: some View {
        VStack(spacing: 6) {
            Spacer()
            Image(systemName: "checkmark.circle")
                .font(.system(size: 24))
                .foregroundColor(Theme.green)
            Text("Alt i hus")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Theme.text)
            Text("Ingen varer mangler akkurat n\u{00E5}")
                .font(.system(size: 11))
                .foregroundColor(Theme.muted)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private func shoppingRow(_ item: ShoppingItem) -> some View {
        ShoppingRow(item: item, onToggle: { checked in
            onToggleItem(item.id, checked)
        }, onSendToOda: {
            onSyncOda([item.id])
        })
    }

    private func clearChecked(_ items: [ShoppingItem]) {
        onDeleteChecked()
    }

    private func sectionHeader(_ text: String, color: Color) -> some View {
        HStack {
            Text(text)
                .font(.system(size: 9, weight: .semibold))
                .foregroundColor(color)
                .textCase(.uppercase)
                .tracking(0.5)
            Spacer()
        }
        .padding(.horizontal, 4)
    }

    // MARK: - Oda cart

    private var odaCartView: some View {
        Group {
            if let cart = odaCart {
                if cart.items.isEmpty {
                    Spacer()
                    VStack(spacing: 6) {
                        Image(systemName: "bag")
                            .font(.system(size: 24))
                            .foregroundColor(Theme.muted)
                        Text("Tom handlekurv")
                            .font(.system(size: 12))
                            .foregroundColor(Theme.muted)
                    }
                    .frame(maxWidth: .infinity)
                    Spacer()
                } else {
                    ScrollView {
                        VStack(spacing: 2) {
                            ForEach(cart.items) { item in
                                OdaCartRow(item: item, onRemove: {
                                    onRemoveOdaItem(item.productId)
                                })
                            }
                        }
                    }

                    Divider().background(Theme.surface.opacity(0.5))

                    HStack {
                        Text("Totalt")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(Theme.text)
                        Spacer()
                        Text("\(cart.totalPrice) kr")
                            .font(.system(size: 13, weight: .bold, design: .rounded))
                            .foregroundColor(.green)
                    }
                }
            } else {
                Spacer()
                ProgressView().tint(Theme.muted).frame(maxWidth: .infinity)
                Spacer()
            }
        }
    }
}
