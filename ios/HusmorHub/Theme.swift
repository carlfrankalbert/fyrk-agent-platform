import SwiftUI

enum Theme {
    // MARK: - Colors (retained for tinting and semantic use)
    static let background = Color(hex: 0x0D0F16)
    static let card = Color(hex: 0x1B1F2E)
    static let surface = Color(hex: 0x242A3A)
    static let accent = Color(hex: 0xA5B4FC)    // Was 818CF8 — brighter indigo, 8.5:1
    static let green = Color(hex: 0x86EFAC)      // Was 6EE7A8 — brighter mint, 11:1
    static let yellow = Color(hex: 0xFDE68A)     // Was FBBF5E — brighter amber, 13:1
    static let red = Color(hex: 0xFCA5A5)        // Was F87171 — brighter red, 8.5:1
    static let text = Color(hex: 0xF2F4F8)       // 15.5:1
    static let muted = Color(hex: 0xA8B4CE)      // Was 8B95B0 — brighter, 7.5:1
    static let dimmed = Color(hex: 0x6B7A94)     // ~4.6:1 on background, for past/inactive text

    // MARK: - Transport line colors
    static let tbaneLine1 = Color(hex: 0x0352A0)
    static let tbaneLine2 = Color(hex: 0xF26522)
    static let tbaneLine5 = Color(hex: 0x00A857)
    static let busRed = Color(hex: 0xE60000)

    static func lineColor(for line: String, mode: String) -> Color {
        if mode == "metro" {
            switch line {
            case "1", "4", "6": return tbaneLine1
            case "2", "3": return tbaneLine2
            case "5": return tbaneLine5
            default: return accent
            }
        }
        return busRed
    }

    // MARK: - Spacing
    static let cardPadding: CGFloat = 14
    static let cardCorner: CGFloat = 16
    static let gap: CGFloat = 10
    static let sectionSpacing: CGFloat = 8

    // MARK: - Typography helpers
    static let labelFont = Font.system(size: 10, weight: .semibold)
    static let captionFont = Font.system(size: 11)
    static let bodyFont = Font.system(size: 14)

    // MARK: - Glass shapes
    static let cardShape = RoundedRectangle(cornerRadius: cardCorner)
    static let pillShape = Capsule()
}

// MARK: - Liquid Glass View Modifiers

extension View {
    /// Primary glass card — used for main content panels (meals, shopping, today)
    func glassCard() -> some View {
        self
            .glassEffect(.regular, in: Theme.cardShape)
    }

    /// Clear glass — more transparent, for overlays on rich backgrounds
    func glassClear() -> some View {
        self
            .glassEffect(.clear, in: Theme.cardShape)
    }

    /// Interactive glass — buttons and tappable elements with bounce/shimmer
    func glassButton(shape: some Shape = Capsule()) -> some View {
        self
            .glassEffect(.regular.interactive(), in: shape)
    }

    /// Subtle glass for status bar / navigation layers
    func glassBar() -> some View {
        self
            .glassEffect(.regular, in: Rectangle())
    }
}

// MARK: - Flow Layout (wrapping tags)

struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }

        return CGSize(width: maxWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

extension Color {
    init(hex: UInt, opacity: Double = 1.0) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}
