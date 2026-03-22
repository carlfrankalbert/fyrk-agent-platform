import SwiftUI

struct TransportCard: View {
    let transport: TransportResponse?

    var body: some View {
        CardContainer(title: "Ut døra") {
            if let t = transport {
                VStack(alignment: .leading, spacing: 6) {
                    Text("fra \(t.stopName)")
                        .font(.system(size: 12))
                        .foregroundColor(Theme.muted)

                    let metro = t.departures.filter { $0.transportMode == "metro" }
                    let bus = t.departures.filter { $0.transportMode == "bus" }

                    if !metro.isEmpty {
                        sectionHeader("T-bane")
                        ForEach(Array(metro.prefix(3).enumerated()), id: \.offset) { _, dep in
                            departureRow(dep)
                        }
                    }

                    if !bus.isEmpty {
                        sectionHeader("Buss")
                        ForEach(Array(bus.prefix(3).enumerated()), id: \.offset) { _, dep in
                            departureRow(dep)
                        }
                    }

                    if metro.isEmpty && bus.isEmpty {
                        Spacer()
                        Text("Ingen avganger")
                            .font(.system(size: 14))
                            .foregroundColor(Theme.muted)
                            .frame(maxWidth: .infinity, alignment: .center)
                        Spacer()
                    }

                    Spacer(minLength: 0)
                }
            } else {
                VStack {
                    Spacer()
                    ProgressView().tint(Theme.muted)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 10, weight: .semibold))
            .foregroundColor(Theme.muted)
            .textCase(.uppercase)
            .tracking(0.8)
    }

    private func departureRow(_ dep: Departure) -> some View {
        HStack(spacing: 8) {
            Text(dep.line)
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.white)
                .frame(width: 26, height: 20)
                .background(Theme.lineColor(for: dep.line, mode: dep.transportMode))
                .cornerRadius(5)

            Text(dep.destination)
                .font(.system(size: 13))
                .foregroundColor(Theme.text)
                .lineLimit(1)

            if dep.delayed && dep.delayMinutes > 0 {
                Text("+\(dep.delayMinutes)")
                    .font(.system(size: 10))
                    .foregroundColor(Theme.yellow)
            }

            Spacer()

            HStack(spacing: 4) {
                if dep.realtime {
                    RealtimeDot()
                }
                Text(dep.minutesText)
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundColor(dep.minutesUntil <= 2 ? Theme.yellow : Theme.text)
            }
        }
        .padding(.vertical, 2)
    }
}

struct RealtimeDot: View {
    @State private var pulsing = false

    var body: some View {
        Circle()
            .fill(Theme.green)
            .frame(width: 6, height: 6)
            .opacity(pulsing ? 0.4 : 1.0)
            .onAppear {
                withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) {
                    pulsing = true
                }
            }
    }
}
