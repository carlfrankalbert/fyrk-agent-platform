import SwiftUI

struct AuthView: View {
    @ObservedObject var api: APIClient

    @State private var code = ""
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(spacing: 32) {
                Text("HUSMOR HUB")
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundColor(Theme.muted)
                    .tracking(4)

                VStack(spacing: 24) {
                    Text("Familiekode")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundColor(Theme.text)

                    Text("Skriv inn tilgangskoden")
                        .font(.system(size: 15))
                        .foregroundColor(Theme.muted)

                    TextField("", text: $code, prompt: Text("Kode").foregroundColor(Theme.muted))
                        .textFieldStyle(.plain)
                        .font(.system(size: 24, weight: .medium, design: .monospaced))
                        .foregroundColor(Theme.text)
                        .multilineTextAlignment(.center)
                        .padding(14)
                        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 10))
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)

                    Button(action: verify) {
                        Group {
                            if loading {
                                ProgressView()
                                    .tint(Theme.text)
                            } else {
                                Text("Logg inn")
                            }
                        }
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(Theme.text)
                        .frame(maxWidth: .infinity)
                        .padding(14)
                        .glassEffect(.regular.tint(Theme.accent).interactive(), in: RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(code.isEmpty || loading)
                    .opacity(code.isEmpty ? 0.5 : 1)

                    if let error = error {
                        Text(error)
                            .font(.system(size: 14))
                            .foregroundColor(Theme.red)
                    }
                }
                .padding(32)
                .glassEffect(.regular, in: RoundedRectangle(cornerRadius: Theme.cardCorner))
                .frame(maxWidth: 400)
            }
        }
    }

    private func verify() {
        loading = true
        error = nil
        Task {
            do {
                try await api.verifyCode(code: code)
            } catch {
                self.error = "Feil kode"
            }
            loading = false
        }
    }
}
