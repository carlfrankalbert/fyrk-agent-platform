import Foundation
import Speech
import AVFoundation

enum SpeechMode: Equatable {
    case idle
    case wake      // Always-on, listening for "Hei Husmor"
    case active    // Transcribing a command after wake word or manual tap
}

@MainActor
class SpeechRecognizer: ObservableObject {
    @Published var transcript = ""
    @Published var mode: SpeechMode = .idle
    @Published var isAvailable = false

    var isListening: Bool { mode == .active }
    var isWakeListening: Bool { mode == .wake }

    private var recognizer: SFSpeechRecognizer?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?

    private var silenceTimer: Timer?
    private let silenceTimeout: TimeInterval = 3.0
    var onAutoComplete: ((String) -> Void)?

    private var sessionID: UInt64 = 0
    private let wakePhrase = "hei husmor"

    init() {
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: "nb-NO"))
    }

    func requestPermission() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            Task { @MainActor in
                self?.isAvailable = status == .authorized
            }
        }
    }

    // MARK: - Public API

    /// Start always-on wake word listening
    func startWakeListening() {
        startRecognition(as: .wake)
    }

    /// Manual tap — go straight to active mode
    func startActive() {
        startRecognition(as: .active)
    }

    /// Stop and send any captured text (manual stop while active)
    func stopAndSend() {
        guard mode == .active else { return }
        finishCommand()
    }

    /// Stop everything
    func stopListening() {
        silenceTimer?.invalidate()
        stopEngine()
        mode = .idle
    }

    // MARK: - Recognition engine

    private func startRecognition(as newMode: SpeechMode) {
        guard let recognizer = recognizer, recognizer.isAvailable else { return }

        stopEngine()
        transcript = ""
        silenceTimer?.invalidate()

        sessionID &+= 1
        let currentSession = sessionID

        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            return
        }

        request = SFSpeechAudioBufferRecognitionRequest()
        guard let request = request else { return }
        request.shouldReportPartialResults = true

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            request.append(buffer)
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                guard let self = self, self.sessionID == currentSession else { return }

                if let result = result {
                    self.handleResult(result.bestTranscription.formattedString, isFinal: result.isFinal)
                }

                if error != nil {
                    self.handleSessionEnd()
                }
            }
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
            mode = newMode
        } catch {
            stopEngine()
        }
    }

    private func handleResult(_ text: String, isFinal: Bool) {
        switch mode {
        case .wake:
            // Check if wake phrase is in the transcript
            let lower = text.lowercased()
            if lower.contains(wakePhrase) {
                // Extract everything after the wake phrase
                if let range = lower.range(of: wakePhrase) {
                    let afterWake = String(text[range.upperBound...]).trimmingCharacters(in: .whitespaces)
                    // Switch to active mode with whatever came after
                    stopEngine()
                    transcript = afterWake
                    startRecognition(as: .active)
                }
            }

        case .active:
            transcript = text
            if isFinal {
                finishCommand()
            } else {
                resetSilenceTimer()
            }

        case .idle:
            break
        }
    }

    private func handleSessionEnd() {
        let currentMode = mode

        if currentMode == .active && !transcript.trimmingCharacters(in: .whitespaces).isEmpty {
            finishCommand()
        } else {
            stopEngine()
            // Auto-restart wake listening when recognition times out (~60s)
            if currentMode == .wake {
                Task {
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    if self.mode == .idle {
                        self.startRecognition(as: .wake)
                    }
                }
            }
        }
    }

    private func finishCommand() {
        guard mode == .active else { return }
        silenceTimer?.invalidate()
        let text = transcript.trimmingCharacters(in: .whitespaces)
        stopEngine()

        if !text.isEmpty {
            onAutoComplete?(text)
        }

        // Return to wake listening after command
        Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            if self.mode == .idle {
                self.startRecognition(as: .wake)
            }
        }
    }

    private func stopEngine() {
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        request = nil
        mode = .idle
    }

    // MARK: - Silence detection

    private func resetSilenceTimer() {
        silenceTimer?.invalidate()
        guard !transcript.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        silenceTimer = Timer.scheduledTimer(withTimeInterval: silenceTimeout, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.finishCommand()
            }
        }
    }
}
