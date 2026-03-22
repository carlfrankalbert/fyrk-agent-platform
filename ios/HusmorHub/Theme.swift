import SwiftUI

enum Theme {
    // MARK: - Colors
    static let background = Color(hex: 0x13151E)
    static let card = Color(hex: 0x1B1F2E)
    static let surface = Color(hex: 0x242A3A)
    static let accent = Color(hex: 0x818CF8)
    static let green = Color(hex: 0x6EE7A8)
    static let yellow = Color(hex: 0xFBBF5E)
    static let red = Color(hex: 0xF87171)
    static let text = Color(hex: 0xF2F4F8)
    static let muted = Color(hex: 0x8B95B0)

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
    static let cardPadding: CGFloat = 12
    static let cardCorner: CGFloat = 12
    static let gap: CGFloat = 8
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
