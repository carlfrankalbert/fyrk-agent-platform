import SwiftUI

struct ShoppingRow: View {
    let item: ShoppingItem
    let onToggle: (Bool) -> Void
    var onSendToOda: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 4) {
            Button(action: { onToggle(!item.checked) }) {
                HStack(spacing: 8) {
                    Image(systemName: item.checked ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 20))
                        .foregroundColor(item.checked ? Theme.green : Theme.muted)

                    Text(itemText)
                        .font(.system(size: 14))
                        .foregroundColor(item.checked ? Theme.muted : Theme.text)
                        .strikethrough(item.checked, color: Theme.muted)
                        .lineLimit(1)
                }
                .frame(minHeight: 32)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Spacer()

            if !item.checked, let sendToOda = onSendToOda {
                Button(action: sendToOda) {
                    Image(systemName: "bag.badge.plus")
                        .font(.system(size: 14))
                        .foregroundColor(Theme.green)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 2)
        .padding(.horizontal, 6)
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

struct OdaCartRow: View {
    let item: OdaCartItem
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            VStack(alignment: .leading, spacing: 1) {
                Text(item.name)
                    .font(.system(size: 12))
                    .foregroundColor(Theme.text)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    Text("\(item.quantity)x")
                        .font(.system(size: 11, design: .rounded))
                        .foregroundColor(Theme.muted)
                    Text("\(item.price) kr")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundColor(.green)
                }
            }

            Spacer()

            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 18))
                    .foregroundColor(Theme.muted)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 6)
    }
}

struct AddItemRow: View {
    let onAdd: (String) -> Void
    @State private var text = ""

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "plus")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Theme.muted)

            TextField("", text: $text, prompt: Text("Legg til vare...").foregroundColor(Theme.muted))
                .font(.system(size: 13))
                .foregroundColor(Theme.text)
                .textFieldStyle(.plain)
                .onSubmit {
                    let trimmed = text.trimmingCharacters(in: .whitespaces)
                    guard !trimmed.isEmpty else { return }
                    onAdd(trimmed)
                    text = ""
                }

            if !text.isEmpty {
                Button(action: {
                    let trimmed = text.trimmingCharacters(in: .whitespaces)
                    guard !trimmed.isEmpty else { return }
                    onAdd(trimmed)
                    text = ""
                }) {
                    Image(systemName: "arrow.right.circle.fill")
                        .font(.system(size: 16))
                        .foregroundColor(Theme.accent)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 10)
        .background(Theme.surface.opacity(0.6))
        .cornerRadius(8)
    }
}
