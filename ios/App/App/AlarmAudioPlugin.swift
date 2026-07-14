import Capacitor
import AVFoundation
import UserNotifications
import MediaPlayer
import WidgetKit
import WatchConnectivity
import ActivityKit

/** Mirror of the struct in ADHDWidget/ADHDWidget.swift — ActivityKit
 *  matches app and widget by type name + encoding, keep them identical. */
@available(iOS 16.2, *)
struct TimerActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var endAt: Date
        var pausedRemaining: Double?
    }

    var timerId: String
    var label: String
    var hue: Double
    var totalSeconds: Double
}

/** Minimal WCSession delegate so the phone can push the next alarm to the
 *  watch app (which schedules its own smart-alarm wake). */
final class WatchLink: NSObject, WCSessionDelegate {
    static let shared = WatchLink()

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        if session.delegate == nil { session.delegate = self }
        if session.activationState != .activated { session.activate() }
    }

    /** at == nil clears the watch alarm */
    func sendAlarm(at: Double?, title: String?) {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        var ctx: [String: Any] = ["cleared": at == nil]
        if let at = at {
            ctx["at"] = at
            ctx["title"] = title ?? "Alarm"
        }
        try? session.updateApplicationContext(ctx)
    }

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {}
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }
}

/**
 * The real-alarm engine. Keeps the app alive in the background with a
 * near-silent looping audio session (category .playback — the same trick
 * Music/Podcasts use, which also plays through the mute switch), and holds
 * a *native* timer for the next alarm: when it fires, the loud bell loops
 * until stop() is called (the user returning to the app) or a 10-minute
 * safety cap. No JavaScript needs to run at ring time, so a locked phone
 * with a suspended webview still rings.
 *
 * Only a fully force-quit app escapes this — nothing can revive that
 * except the scheduled local-notification chain (see LocalNotifications).
 */
@objc(AlarmAudioPlugin)
public class AlarmAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AlarmAudioPlugin"
    public let jsName = "AlarmAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startKeepAlive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleRing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelRing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ring", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWidgetData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncTimerActivities", returnType: CAPPluginReturnPromise),
    ]

    static let appGroup = "group.be.adhdcalendar.app"

    public override func load() {
        WatchLink.shared.activate()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAudioInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance()
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
    }

    private var player: AVAudioPlayer?
    private var ringTimer: DispatchSourceTimer?
    private var capTimer: DispatchSourceTimer?
    private let maxRingSeconds: Double = 600
    private let minAlarmVolume: Float = 0.6
    private let volumeView = MPVolumeView(frame: CGRect(x: -2000, y: -2000, width: 10, height: 10))
    private let bannerId = "alarm-ring-banner"
    private let fallbackAlarmResource = "alarm"
    private var ringResource = "alarm"
    private var ringTitle: String?
    private var ringBody: String?
    private var isAlarmRinging = false
    private var scheduledAtMs: Double?

    private func activateSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default, options: [])
        try session.setActive(true)
    }

    @discardableResult
    private func play(resource: String) -> Bool {
        guard let url = Bundle.main.url(forResource: resource, withExtension: "wav") else {
            return false
        }
        do {
            try activateSession()
            let p = try AVAudioPlayer(contentsOf: url)
            p.numberOfLoops = -1
            p.volume = 1.0
            player?.stop()
            player = p
            p.prepareToPlay()
            return p.play()
        } catch {
            return false
        }
    }

    private func playSilence() {
        play(resource: "silence")
    }

    @objc private func handleDidEnterBackground() {
        if isAlarmRinging {
            _ = play(resource: ringResource)
        } else if scheduledAtMs != nil {
            playSilence()
        }
    }

    @objc private func handleAudioInterruption(_ notification: Notification) {
        guard
            let info = notification.userInfo,
            let rawType = info[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: rawType),
            type == .ended
        else { return }

        if isAlarmRinging {
            _ = play(resource: ringResource)
        } else if scheduledAtMs != nil {
            playSilence()
        }
    }

    private func validAlarmResource(_ resource: String?) -> String {
        guard let resource = resource,
              Bundle.main.url(forResource: resource, withExtension: "wav") != nil else {
            return fallbackAlarmResource
        }
        return resource
    }

    /**
     * A real alarm clock refuses to be silenced by a media volume that was
     * dialed to zero hours earlier. If the system output volume is below
     * the floor, push it up via MPVolumeView (the standard alarm-app
     * technique) right as the bell starts.
     */
    private func ensureLoudEnough() {
        DispatchQueue.main.async {
            if self.volumeView.superview == nil {
                let window = UIApplication.shared.connectedScenes
                    .compactMap { $0 as? UIWindowScene }
                    .flatMap { $0.windows }
                    .first
                window?.addSubview(self.volumeView)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                let current = AVAudioSession.sharedInstance().outputVolume
                if current < self.minAlarmVolume,
                   let slider = self.volumeView.subviews.compactMap({ $0 as? UISlider }).first {
                    slider.value = self.minAlarmVolume
                }
            }
        }
    }

    /**
     * The pending notification chain gets cancelled once the live bell
     * rings (no double audio). This banner is intentionally passive and
     * soundless: the iPhone audio loop is the alarm; we do not want iOS to
     * convert the banner into another Apple Watch ping.
     */
    private func showPassiveBanner() {
        let content = UNMutableNotificationContent()
        content.title = ringTitle ?? "⏰ Alarm"
        content.body = ringBody ?? "Ringing — open the app to stop"
        content.sound = nil
        if #available(iOS 15.0, *) {
            content.interruptionLevel = .passive
        }
        let request = UNNotificationRequest(identifier: bannerId, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    /** Store today's items for the home-screen widget (app group storage). */
    @objc func setWidgetData(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("missing 'json'")
            return
        }
        guard let defaults = UserDefaults(suiteName: AlarmAudioPlugin.appGroup) else {
            call.reject("app group not configured")
            return
        }
        defaults.set(json, forKey: "widget-data")
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve()
    }

    /**
     * Mirror the running timers onto the lock screen as Live Activities.
     * The countdown renders natively (Text(timerInterval:)), so it keeps
     * ticking while the app is suspended. Called with the full timer list
     * on every change; ends activities whose timer is gone, updates the
     * changed ones, starts the new ones.
     */
    @objc func syncTimerActivities(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        let items = (call.getArray("timers") ?? []).compactMap { $0 as? [String: Any] }
        Task { @MainActor in
            var wanted: [String: (label: String, hue: Double, total: Double, endAt: Date, paused: Double?)] = [:]
            for obj in items {
                guard let id = obj["id"] as? String,
                      let endAtMs = obj["endAt"] as? Double,
                      let totalMs = obj["totalMs"] as? Double else { continue }
                wanted[id] = (
                    label: obj["label"] as? String ?? "Timer",
                    hue: obj["hue"] as? Double ?? 210,
                    total: totalMs / 1000,
                    endAt: Date(timeIntervalSince1970: endAtMs / 1000),
                    paused: (obj["pausedRemaining"] as? Double).map { $0 / 1000 }
                )
            }
            for activity in Activity<TimerActivityAttributes>.activities {
                if let w = wanted.removeValue(forKey: activity.attributes.timerId) {
                    let state = TimerActivityAttributes.ContentState(endAt: w.endAt, pausedRemaining: w.paused)
                    await activity.update(ActivityContent(state: state, staleDate: nil))
                } else {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
            for (id, w) in wanted {
                let attrs = TimerActivityAttributes(timerId: id, label: w.label, hue: w.hue, totalSeconds: w.total)
                let state = TimerActivityAttributes.ContentState(endAt: w.endAt, pausedRemaining: w.paused)
                _ = try? Activity.request(
                    attributes: attrs,
                    content: ActivityContent(state: state, staleDate: nil),
                    pushType: nil
                )
            }
            call.resolve()
        }
    }

    private func playAlarm() {
        isAlarmRinging = true
        scheduledAtMs = nil
        // The live phone bell owns this moment. Remove fallback
        // notifications before starting audio, so a paired Watch cannot
        // surface them as a small ping while the iPhone is about to ring.
        cancelImminentNotifications()
        guard play(resource: ringResource) else {
            isAlarmRinging = false
            return
        }
        ensureLoudEnough()
        showPassiveBanner()
        // safety cap: after 10 minutes of unanswered ringing, back to keep-alive
        capTimer?.cancel()
        let t = DispatchSource.makeTimerSource(queue: .main)
        t.schedule(deadline: .now() + maxRingSeconds, leeway: .seconds(1))
        t.setEventHandler { [weak self] in
            self?.isAlarmRinging = false
            self?.playSilence()
        }
        t.resume()
        capTimer = t
    }

    private func cancelImminentNotifications() {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { requests in
            let soon = Date().addingTimeInterval(10 * 60)
            let ids = requests.compactMap { req -> String? in
                var fireDate: Date?
                if let t = req.trigger as? UNCalendarNotificationTrigger {
                    fireDate = t.nextTriggerDate()
                } else if let t = req.trigger as? UNTimeIntervalNotificationTrigger {
                    fireDate = t.nextTriggerDate()
                }
                if let d = fireDate, d <= soon {
                    return req.identifier
                }
                return nil
            }
            if !ids.isEmpty {
                center.removePendingNotificationRequests(withIdentifiers: ids)
            }
        }
    }

    @objc func startKeepAlive(_ call: CAPPluginCall) {
        if player == nil {
            playSilence()
        }
        player != nil ? call.resolve() : call.reject("silence.wav not bundled")
    }

    /** Arm the native timer for the next alarm (epoch milliseconds). */
    @objc func scheduleRing(_ call: CAPPluginCall) {
        guard let atMs = call.getDouble("at") else {
            call.reject("missing 'at'")
            return
        }
        ringTitle = call.getString("title")
        ringBody = call.getString("body")
        ringResource = validAlarmResource(call.getString("sound"))
        if player == nil {
            playSilence() // the session must be live before the phone locks
        }
        ringTimer?.cancel()
        let delay = max(0, atMs / 1000 - Date().timeIntervalSince1970)
        scheduledAtMs = atMs
        if delay <= 0.25 {
            playAlarm()
            WatchLink.shared.sendAlarm(at: nil, title: nil)
            call.resolve()
            return
        }
        let t = DispatchSource.makeTimerSource(queue: .main)
        t.schedule(deadline: .now() + delay, leeway: .milliseconds(100))
        t.setEventHandler { [weak self] in self?.playAlarm() }
        t.resume()
        ringTimer = t
        // mirror to the watch so it can wake the wrist at the same moment
        WatchLink.shared.sendAlarm(at: atMs, title: ringTitle)
        call.resolve()
    }

    @objc func cancelRing(_ call: CAPPluginCall) {
        ringTimer?.cancel()
        ringTimer = nil
        scheduledAtMs = nil
        WatchLink.shared.sendAlarm(at: nil, title: nil)
        call.resolve()
    }

    /** Ring immediately (backup path used when JS happens to be awake). */
    @objc func ring(_ call: CAPPluginCall) {
        ringResource = validAlarmResource(call.getString("sound"))
        playAlarm()
        call.resolve()
    }

    /** Stop the bell but keep the quiet keep-alive so future alarms work. */
    @objc func stop(_ call: CAPPluginCall) {
        capTimer?.cancel()
        capTimer = nil
        isAlarmRinging = false
        scheduledAtMs = nil
        playSilence()
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [bannerId])
        call.resolve()
    }
}

/**
 * Capacitor only auto-registers plugins that live in npm packages (the CLI
 * scans those to build packageClassList) — app-local plugins like the one
 * above must be registered in code. The storyboard points at this subclass.
 */
// no @objc rename here: the storyboard looks the class up as
// "App.AlarmViewController", which only matches the default Swift name
class AlarmViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AlarmAudioPlugin())
        bridge?.registerPluginInstance(GoogleAuthPlugin())
    }
}
