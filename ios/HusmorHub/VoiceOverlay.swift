import SwiftUI

// Only shows centered transcript/reply. Passes touches through to content below.

struct VoiceOverlay: View {
    @ObservedObject var speech: SpeechRecognizer
    @ObservedObject var speaker: HusmorSpeaker
    @Binding var voiceReply: String?

    private var isShowingContent: Bool {
        speech.isListening || voiceReply != nil
    }

    var body: some View {
        ZStack {
            // Dim background when voice is active
            if isShowingContent {
                Theme.background.opacity(0.6)
                    .ignoresSafeArea()
                    .onTapGesture {
                        if speech.isListening {
                            speech.stopAndSend()
                        }
                        withAnimation { voiceReply = nil }
                    }
            }

            // Centered content
            if speech.isListening {
                VStack(spacing: 16) {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 28))
                        .foregroundColor(Theme.red)
                        .symbolEffect(.pulse, isActive: true)

                    if !speech.transcript.isEmpty {
                        Text(speech.transcript)
                            .font(.system(size: 28, weight: .medium))
                            .foregroundColor(Theme.text)
                            .multilineTextAlignment(.center)
                            .padding(24)
                            .frame(maxWidth: 600)
                            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 20))
                    } else {
                        Text("Snakk nå...")
                            .font(.system(size: 22, weight: .medium))
                            .foregroundColor(Theme.muted)
                    }
                }
                .transition(.opacity)
            } else if let reply = voiceReply {
                VStack(spacing: 12) {
                    if speaker.isSpeaking {
                        Image(systemName: "speaker.wave.3.fill")
                            .font(.system(size: 22))
                            .foregroundColor(Theme.accent)
                            .symbolEffect(.variableColor, isActive: true)
                    }
                    Text(reply)
                        .font(.system(size: 24, weight: .medium))
                        .foregroundColor(Theme.text)
                        .multilineTextAlignment(.center)
                }
                    .padding(24)
                    .frame(maxWidth: 500)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 20))
                    .transition(.opacity)
                    .onTapGesture {
                        speaker.stop()
                        withAnimation { voiceReply = nil }
                    }
                    .onAppear {
                        // Auto-dismiss after speaking finishes (or 8s fallback)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
                            if !speaker.isSpeaking {
                                withAnimation { voiceReply = nil }
                            }
                        }
                    }
            }
        }
        .allowsHitTesting(isShowingContent)
        .animation(.easeInOut(duration: 0.25), value: speech.isListening)
        .animation(.easeInOut(duration: 0.3), value: voiceReply != nil)
    }
}
