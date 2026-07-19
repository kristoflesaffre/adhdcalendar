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

/** One upcoming ring, mirrored from the JS alarm engine. */
private struct QueuedRing: Codable {
    let at: Double // epoch ms
    let key: String
    let title: String?
    let body: String?
    let sound: String
}

/**
 * The real-alarm engine. Keeps the app alive in the background with a
 * near-silent looping audio session (category .playback — the same trick
 * Music/Podcasts use, which also plays through the mute switch), and holds
 * a *native queue* of upcoming alarms: a native timer fires the first one
 * (looping the loud bell until stop() or a 10-minute cap), after which the
 * plugin re-arms itself for the next queued alarm — no JavaScript needs to
 * run at ring time OR between consecutive alarms, so a locked phone with a
 * suspended webview rings every alarm on time.
 *
 * The queue is persisted (app-group defaults) and restored on launch, and a
 * catch-up pass runs whenever the app wakes (didBecomeActive / audio
 * interruption ended): a trigger moment that slipped past while iOS had us
 * suspended still rings, up to 15 minutes late, instead of staying silent.
 *
 * Only a fully force-quit app escapes this — nothing can revive that
 * except the scheduled local-notification chain, which this plugin also
 * schedules natively (syncAlarmNotifications) with the bundled alarm sound.
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
        CAPPluginMethod(name: "syncAlarmNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelAlarmChain", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleTestNotification", returnType: CAPPluginReturnPromise),
    ]

    static let appGroup = "group.be.adhdcalendar.app"
    static let testAlarmId = "carillon-test-alarm"

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
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
        // A relaunched app must protect its alarms before the webview has
        // even loaded: restore the persisted queue and arm immediately.
        restoreQueue()
        if !ringQueue.isEmpty {
            DispatchQueue.main.async { [weak self] in
                guard let self = self, !self.isAlarmRinging else { return }
                if self.player?.isPlaying != true { self.playSilence() }
                self.armFront()
            }
        }
    }

    private var player: AVAudioPlayer?
    private var ringTimer: DispatchSourceTimer?
    private var capTimer: DispatchSourceTimer?
    private let maxRingSeconds: Double = 600
    /** ring up to this many seconds after a missed trigger moment */
    private let lateRingSeconds: Double = 15 * 60
    private let minAlarmVolume: Float = 0.6
    private let volumeView = MPVolumeView(frame: CGRect(x: -2000, y: -2000, width: 10, height: 10))
    private let bannerId = "alarm-ring-banner"
    private let fallbackAlarmResource = "alarm"
    private let queueDefaultsKey = "alarm-ring-queue"
    private var ringQueue: [QueuedRing] = []
    private var ringResource = "alarm"
    private var ringKey: String?
    private var ringTitle: String?
    private var ringBody: String?
    private var isAlarmRinging = false

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

    /* ------------------- the native alarm queue ------------------- */

    private func queueDefaults() -> UserDefaults {
        UserDefaults(suiteName: AlarmAudioPlugin.appGroup) ?? .standard
    }

    private func persistQueue() {
        if let data = try? JSONEncoder().encode(ringQueue) {
            queueDefaults().set(data, forKey: queueDefaultsKey)
        }
    }

    private func restoreQueue() {
        guard let data = queueDefaults().data(forKey: queueDefaultsKey),
              let queue = try? JSONDecoder().decode([QueuedRing].self, from: data) else { return }
        let cutoff = Date().timeIntervalSince1970 - lateRingSeconds
        ringQueue = queue.filter { $0.at / 1000 > cutoff }.sorted { $0.at < $1.at }
    }

    /**
     * Arm the native timer for the first queued alarm. A trigger moment that
     * already slipped past (but is inside the late window) rings immediately —
     * that's the catch-up path after a suspension or relaunch. Never called
     * while the bell is ringing; the ring's stop/cap re-arms afterwards.
     */
    private func armFront() {
        ringTimer?.cancel()
        ringTimer = nil
        let nowS = Date().timeIntervalSince1970
        ringQueue.removeAll { $0.at / 1000 <= nowS - lateRingSeconds }
        persistQueue()
        guard let next = ringQueue.first else {
            WatchLink.shared.sendAlarm(at: nil, title: nil)
            return
        }
        ringKey = next.key
        ringTitle = next.title
        ringBody = next.body
        ringResource = validAlarmResource(next.sound)
        let delay = next.at / 1000 - nowS
        if delay <= 0.25 {
            ringQueue.removeFirst()
            persistQueue()
            playAlarm()
            WatchLink.shared.sendAlarm(at: nil, title: nil)
            return
        }
        let t = DispatchSource.makeTimerSource(queue: .main)
        t.schedule(deadline: .now() + delay, leeway: .milliseconds(100))
        t.setEventHandler { [weak self] in
            guard let self = self else { return }
            if let first = self.ringQueue.first, first.key == self.ringKey {
                self.ringQueue.removeFirst()
                self.persistQueue()
            }
            self.playAlarm()
        }
        t.resume()
        ringTimer = t
        // mirror to the watch so it can wake the wrist at the same moment
        WatchLink.shared.sendAlarm(at: next.at, title: next.title)
    }

    /** After any wake-up: revive the keep-alive session and ring anything
     *  whose moment passed while iOS had us suspended. */
    private func resumeAfterWake() {
        guard !isAlarmRinging else {
            if player?.isPlaying != true { _ = play(resource: ringResource) }
            return
        }
        if player?.isPlaying != true, !ringQueue.isEmpty { playSilence() }
        if let next = ringQueue.first, next.at / 1000 <= Date().timeIntervalSince1970 {
            armFront() // overdue within the late window — rings now
        } else if ringTimer == nil, !ringQueue.isEmpty {
            armFront() // timer died while suspended — re-arm
        }
    }

    @objc private func handleDidEnterBackground() {
        if isAlarmRinging {
            _ = play(resource: ringResource)
        } else if !ringQueue.isEmpty {
            if player?.isPlaying != true { playSilence() }
        }
    }

    @objc private func handleDidBecomeActive() {
        resumeAfterWake()
    }

    @objc private func handleAudioInterruption(_ notification: Notification) {
        guard
            let info = notification.userInfo,
            let rawType = info[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: rawType),
            type == .ended
        else { return }
        resumeAfterWake()
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
        guard play(resource: ringResource) else {
            // Keep the OS-scheduled notification fallback intact when direct
            // playback cannot start. It can still deliver the bundled sound.
            isAlarmRinging = false
            return
        }
        // Direct playback is confirmed. Remove only this alarm's fallback
        // chain, leaving nearby appointments fully protected.
        cancelCurrentAlarmNotifications()
        ensureLoudEnough()
        showPassiveBanner()
        // safety cap: after 10 minutes of unanswered ringing, hand over to
        // the keep-alive silence and re-arm for the next queued alarm
        capTimer?.cancel()
        let t = DispatchSource.makeTimerSource(queue: .main)
        t.schedule(deadline: .now() + maxRingSeconds, leeway: .seconds(1))
        t.setEventHandler { [weak self] in
            guard let self = self else { return }
            self.isAlarmRinging = false
            self.playSilence()
            self.armFront()
        }
        t.resume()
        capTimer = t
    }

    private func cancelCurrentAlarmNotifications() {
        guard let currentKey = ringKey else { return }
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { requests in
            let ids = requests
                .filter { $0.content.threadIdentifier == currentKey }
                .map(\.identifier)
            if !ids.isEmpty {
                center.removePendingNotificationRequests(withIdentifiers: ids)
            }
        }
    }

    @objc func startKeepAlive(_ call: CAPPluginCall) {
        if player?.isPlaying != true {
            playSilence()
        }
        player?.isPlaying == true
            ? call.resolve()
            : call.reject("silence.wav could not start")
    }

    /**
     * Replace the native alarm queue with the given upcoming rings
     * (`queue`: [{at, key, title, body, sound}], sorted or not). The single
     * `at`/`key`/... form is still accepted for one-off test rings.
     */
    @objc func scheduleRing(_ call: CAPPluginCall) {
        var items: [QueuedRing] = []
        if let queue = call.getArray("queue") {
            for case let obj as [String: Any] in queue {
                guard let at = obj["at"] as? Double, let key = obj["key"] as? String else { continue }
                items.append(QueuedRing(
                    at: at,
                    key: key,
                    title: obj["title"] as? String,
                    body: obj["body"] as? String,
                    sound: obj["sound"] as? String ?? fallbackAlarmResource
                ))
            }
        } else if let at = call.getDouble("at") {
            items.append(QueuedRing(
                at: at,
                key: call.getString("key") ?? "single",
                title: call.getString("title"),
                body: call.getString("body"),
                sound: call.getString("sound") ?? fallbackAlarmResource
            ))
        } else {
            call.reject("missing 'queue' or 'at'")
            return
        }
        ringQueue = items.sorted { $0.at < $1.at }
        persistQueue()
        if player?.isPlaying != true {
            playSilence() // the session must be live before the phone locks
        }
        guard player?.isPlaying == true || isAlarmRinging else {
            call.reject("background audio session could not start")
            return
        }
        // never clobber a bell that is ringing right now — the queue is
        // armed automatically when it stops
        if !isAlarmRinging { armFront() }
        call.resolve()
    }

    @objc func cancelRing(_ call: CAPPluginCall) {
        ringTimer?.cancel()
        ringTimer = nil
        ringQueue = []
        persistQueue()
        if !isAlarmRinging { ringKey = nil }
        WatchLink.shared.sendAlarm(at: nil, title: nil)
        call.resolve()
    }

    /** Ring immediately (backup path used when JS happens to be awake). */
    @objc func ring(_ call: CAPPluginCall) {
        ringKey = call.getString("key")
        ringResource = validAlarmResource(call.getString("sound"))
        if let key = ringKey {
            ringQueue.removeAll { $0.key == key }
            persistQueue()
        }
        playAlarm()
        call.resolve()
    }

    /** Stop the bell, keep the quiet keep-alive, and re-arm the next alarm. */
    @objc func stop(_ call: CAPPluginCall) {
        capTimer?.cancel()
        capTimer = nil
        isAlarmRinging = false
        ringKey = nil
        playSilence()
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [bannerId])
        armFront()
        call.resolve()
    }

    /* ------------- OS-scheduled notification fallback ------------- */

    /**
     * Replace all pending fallback notifications (except a running test)
     * with the given set. Scheduled natively rather than through the
     * LocalNotifications plugin so the app can manage the complete fallback
     * chain and its bundled sound in one native operation.
     */
    @objc func syncAlarmNotifications(_ call: CAPPluginCall) {
        let items = (call.getArray("notifications") ?? []).compactMap { $0 as? [String: Any] }
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { existing in
            let removable = existing.map(\.identifier).filter { $0 != AlarmAudioPlugin.testAlarmId }
            if !removable.isEmpty {
                center.removePendingNotificationRequests(withIdentifiers: removable)
            }
            let nowS = Date().timeIntervalSince1970
            for obj in items {
                guard let id = obj["id"] as? String,
                      let atMs = obj["at"] as? Double,
                      atMs / 1000 > nowS else { continue }
                let content = UNMutableNotificationContent()
                content.title = obj["title"] as? String ?? "Alarm"
                content.body = obj["body"] as? String ?? ""
                if let soundFile = obj["sound"] as? String {
                    content.sound = UNNotificationSound(named: UNNotificationSoundName(soundFile))
                }
                if let thread = obj["threadKey"] as? String {
                    content.threadIdentifier = thread
                }
                if #available(iOS 15.0, *) {
                    content.interruptionLevel = .active
                }
                let date = Date(timeIntervalSince1970: atMs / 1000)
                let comps = Calendar.current.dateComponents(
                    [.year, .month, .day, .hour, .minute, .second], from: date)
                let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
                center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
            }
            call.resolve()
        }
    }

    /** Cancel the remaining fallback chain for one alarm key (on dismiss). */
    @objc func cancelAlarmChain(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.resolve()
            return
        }
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { requests in
            let ids = requests
                .filter { $0.content.threadIdentifier == key }
                .map(\.identifier)
            if !ids.isEmpty {
                center.removePendingNotificationRequests(withIdentifiers: ids)
            }
            call.resolve()
        }
    }

    /** One audible test notification, ~25s after the test ring. */
    @objc func scheduleTestNotification(_ call: CAPPluginCall) {
        let after = call.getDouble("afterSeconds") ?? 30
        let content = UNMutableNotificationContent()
        content.title = "🔔 Test alarm"
        content.body = "Scheduled \(Int(after))s ago — if you can hear this, alarms work."
        content.sound = UNNotificationSound(
            named: UNNotificationSoundName(call.getString("sound") ?? "alarm.wav"))
        content.threadIdentifier = AlarmAudioPlugin.testAlarmId
        if #available(iOS 15.0, *) {
            content.interruptionLevel = .active
        }
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, after + 25), repeats: false)
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: AlarmAudioPlugin.testAlarmId, content: content, trigger: trigger))
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
