import AVFoundation

@MainActor
class HusmorSpeaker: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published var isSpeaking = false

    var volume: Float {
        get { UserDefaults.standard.object(forKey: "speaker_volume") as? Float ?? 0.8 }
        set { UserDefaults.standard.set(newValue, forKey: "speaker_volume") }
    }

    private let synthesizer = AVSpeechSynthesizer()
    private var norwegianVoice: AVSpeechSynthesisVoice?

    override init() {
        super.init()
        synthesizer.delegate = self

        // Prefer enhanced Norwegian voice, fall back to any nb-NO
        let nbVoices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == "nb-NO" }
        norwegianVoice = nbVoices.first(where: { $0.quality == .enhanced })
            ?? nbVoices.first(where: { $0.quality == .premium })
            ?? nbVoices.first
    }

    func speak(_ text: String) {
        synthesizer.stopSpeaking(at: .immediate)

        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = norwegianVoice ?? AVSpeechSynthesisVoice(language: "nb-NO")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        utterance.pitchMultiplier = 1.0
        utterance.volume = volume

        // Switch audio session to playback so speech comes through speaker
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)

        isSpeaking = true
        synthesizer.speak(utterance)
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
        isSpeaking = false
    }

    // MARK: - AVSpeechSynthesizerDelegate

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.isSpeaking = false
            // Restore audio session for mic input
            try? AVAudioSession.sharedInstance().setCategory(.record, mode: .measurement, options: .duckOthers)
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.isSpeaking = false
        }
    }
}
