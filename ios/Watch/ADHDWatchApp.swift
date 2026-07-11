import SwiftUI
import WatchKit
import WatchConnectivity

/**
 * ADHD Calendar — watchOS companion. The iPhone pushes the next alarm
 * moment over WatchConnectivity; this app schedules a *smart alarm*
 * extended-runtime session for that exact time. When it fires, the watch
 * wakes you with strong repeating haptics (works with the screen off, up
 * to 30 minutes — the same mechanism dedicated alarm apps use) and shows
 * a Stop screen; raising your wrist also lets the app play the melody
 * out loud while it's frontmost.
 *
 * Setup: see README-WATCH.md in this folder.
 */

final class AlarmManager: NSObject, ObservableObject, WCSessionDelegate, WKExtendedRuntimeSessionDelegate {
    @Published var nextAlarmAt: Date?
    @Published var nextTitle: String = "Alarm"
    @Published var ringing = false

    private var runtimeSession: WKExtendedRuntimeSession?

    override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
        // pick up the context that arrived while the app wasn't running
        applyContext(WCSession.default.receivedApplicationContext)
    }

    // MARK: - phone → watch

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async { self.applyContext(session.receivedApplicationContext) }
    }

    func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        DispatchQueue.main.async { self.applyContext(context) }
    }

    private func applyContext(_ context: [String: Any]) {
        if let at = context["at"] as? Double {
            let date = Date(timeIntervalSince1970: at / 1000)
            nextAlarmAt = date
            nextTitle = context["title"] as? String ?? "Alarm"
            scheduleSmartAlarm(at: date)
        } else if context["cleared"] as? Bool == true {
            nextAlarmAt = nil
            runtimeSession?.invalidate()
            runtimeSession = nil
        }
    }

    // MARK: - smart alarm session

    private func scheduleSmartAlarm(at date: Date) {
        guard date.timeIntervalSinceNow > 0 else { return }
        runtimeSession?.invalidate()
        let session = WKExtendedRuntimeSession()
        session.delegate = self
        session.start(at: date)
        runtimeSession = session
    }

    func extendedRuntimeSessionDidStart(_ session: WKExtendedRuntimeSession) {
        DispatchQueue.main.async { self.ringing = true }
        // strong haptic every 2s, screen on or off, until stopped (max 30 min)
        session.notifyUser(hapticType: .notification) { _ in 2.0 }
    }

    func extendedRuntimeSession(
        _ session: WKExtendedRuntimeSession,
        didInvalidateWith reason: WKExtendedRuntimeSessionInvalidationReason,
        error: Error?
    ) {
        DispatchQueue.main.async { self.ringing = false }
    }

    func extendedRuntimeSessionWillExpire(_ session: WKExtendedRuntimeSession) {}

    func stopRinging() {
        runtimeSession?.invalidate()
        runtimeSession = nil
        ringing = false
        nextAlarmAt = nil
    }
}

struct ContentView: View {
    @ObservedObject var manager: AlarmManager

    var body: some View {
        if manager.ringing {
            VStack(spacing: 14) {
                Text("🔔")
                    .font(.system(size: 40))
                Text(manager.nextTitle)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                Button(action: { manager.stopRinging() }) {
                    Text("Stop")
                        .font(.title3.bold())
                        .frame(maxWidth: .infinity)
                }
                .tint(.red)
                .buttonStyle(.borderedProminent)
            }
            .padding()
        } else {
            VStack(spacing: 10) {
                Image(systemName: "bell.badge.fill")
                    .font(.title2)
                    .foregroundStyle(.green)
                if let next = manager.nextAlarmAt {
                    Text("Next alarm")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(next, style: .time)
                        .font(.title2.bold().monospacedDigit())
                    Text(manager.nextTitle)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                } else {
                    Text("No alarm armed")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text("Open ADHD Calendar on your iPhone to sync.")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding()
        }
    }
}

@main
struct ADHDWatchApp: App {
    @StateObject private var manager = AlarmManager()

    var body: some Scene {
        WindowGroup {
            ContentView(manager: manager)
        }
    }
}
