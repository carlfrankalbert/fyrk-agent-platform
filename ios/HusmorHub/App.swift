import SwiftUI
import UIKit

@main
struct HusmorHubApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var api = APIClient.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView(api: api)
                .preferredColorScheme(.dark)
                .onAppear { Self.forceLandscape() }
                .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
                    Self.forceLandscape()
                }
        }
        .onChange(of: scenePhase) {
            Self.forceLandscape()
            if scenePhase == .background {
                UsageTracker.shared.flush()
            }
        }
    }

    static func forceLandscape() {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene else { return }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscape)) { error in
            // Retry once after short delay if it fails
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscape))
            }
        }
    }
}

struct RootView: View {
    @ObservedObject var api: APIClient
    @State private var checking = true

    var body: some View {
        Group {
            if checking {
                ZStack {
                    Theme.background.ignoresSafeArea()
                    ProgressView()
                        .tint(Theme.muted)
                }
            } else if api.isAuthenticated {
                DashboardView(api: api)
            } else {
                AuthView(api: api)
            }
        }
        .persistentSystemOverlays(.hidden)
        .task {
            await api.checkAuth()
            checking = false
        }
    }
}

class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        application.isIdleTimerDisabled = true
        return true
    }

    func application(_ application: UIApplication,
                     supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        return .landscape
    }
}
