import WidgetKit
import SwiftUI
import ActivityKit

/**
 * ADHD Calendar home-screen widget — a Todoist-style "Today" card: events
 * and check-off tasks with their times. Data comes from the main app via
 * app-group storage (see AlarmAudioPlugin.setWidgetData); the app refreshes
 * it on every change.
 *
 * Setup: see README-WIDGET.md in this folder.
 */

private let appGroup = "group.be.adhdcalendar.app"

struct WidgetItem: Codable, Identifiable {
    var id: String { "\(type)-\(title)-\(time ?? "")" }
    let type: String // "event" | "task"
    let title: String
    let time: String?
    let done: Bool?
    let color: String
}

struct WidgetPayload: Codable {
    let updatedAt: Double
    let today: [WidgetItem]
    let tomorrow: [WidgetItem]
}

struct TodayEntry: TimelineEntry {
    let date: Date
    let items: [WidgetItem]
}

struct Provider: TimelineProvider {
    private func load() -> [WidgetItem] {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let json = defaults.string(forKey: "widget-data"),
              let data = json.data(using: .utf8),
              let payload = try? JSONDecoder().decode(WidgetPayload.self, from: data)
        else { return [] }
        return payload.today
    }

    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: Date(), items: [
            WidgetItem(type: "task", title: "Take medication", time: "09:00", done: false, color: "#206657"),
            WidgetItem(type: "event", title: "Weekly planning", time: "09:30", done: nil, color: "#3a5bc7"),
        ])
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(TodayEntry(date: Date(), items: load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let entry = TodayEntry(date: Date(), items: load())
        // refresh at the next midnight; the app also force-reloads on changes
        let midnight = Calendar.current.startOfDay(for: Date()).addingTimeInterval(86_400)
        completion(Timeline(entries: [entry], policy: .after(midnight)))
    }
}

private func uiColor(_ hex: String) -> Color {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt64(s, radix: 16) else { return .green }
    return Color(
        red: Double((v >> 16) & 0xFF) / 255,
        green: Double((v >> 8) & 0xFF) / 255,
        blue: Double(v & 0xFF) / 255
    )
}

struct TodayWidgetView: View {
    var entry: TodayEntry
    @Environment(\.widgetFamily) var family

    private var maxRows: Int { family == .systemLarge ? 8 : 3 }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Today")
                    .font(.headline.bold())
                    .foregroundColor(Color(red: 0.13, green: 0.4, blue: 0.34))
                Text("\(entry.items.filter { !($0.done ?? false) }.count)")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                Spacer()
                Image(systemName: "bell.fill")
                    .font(.caption)
                    .foregroundColor(Color(red: 0.13, green: 0.4, blue: 0.34))
            }

            if entry.items.isEmpty {
                Spacer()
                Text("Nothing planned — enjoy! 🎉")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                Spacer()
            } else {
                ForEach(entry.items.prefix(maxRows)) { item in
                    HStack(spacing: 8) {
                        if item.type == "task" {
                            Circle()
                                .strokeBorder(uiColor(item.color), lineWidth: 1.8)
                                .background(
                                    Circle().fill((item.done ?? false) ? uiColor(item.color) : .clear)
                                )
                                .frame(width: 16, height: 16)
                        } else {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(uiColor(item.color))
                                .frame(width: 4, height: 16)
                        }
                        Text(item.title)
                            .font(.subheadline)
                            .strikethrough(item.done ?? false)
                            .foregroundColor((item.done ?? false) ? .secondary : .primary)
                            .lineLimit(1)
                        Spacer()
                        if let time = item.time {
                            Text(time)
                                .font(.caption.monospacedDigit().bold())
                                .foregroundColor(uiColor(item.color))
                        }
                    }
                    if item.id != entry.items.prefix(maxRows).last?.id {
                        Divider()
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding()
    }
}

struct ADHDWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ADHDTodayWidget", provider: Provider()) { entry in
            if #available(iOS 17.0, *) {
                TodayWidgetView(entry: entry)
                    .containerBackground(.background, for: .widget)
            } else {
                TodayWidgetView(entry: entry)
            }
        }
        .configurationDisplayName("Today")
        .description("Today's events and tasks, with alarm times.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

@main
struct ADHDWidgetBundle: WidgetBundle {
    var body: some Widget {
        ADHDWidget()
        TimerLiveActivity()
    }
}

/* ============================================================
   Timer Live Activity — running timers on the lock screen.
   The app starts/updates/ends these via AlarmAudioPlugin
   (syncTimerActivities); the countdown itself renders natively,
   so it keeps ticking while the app is suspended.

   NOTE: this struct is mirrored in AlarmAudioPlugin.swift (the
   app target). ActivityKit matches the two by type name and
   encoding, so both definitions must stay identical.
   ============================================================ */

struct TimerActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /** the moment the timer hits zero */
        var endAt: Date
        /** remaining seconds, set only while paused */
        var pausedRemaining: Double?
    }

    var timerId: String
    var label: String
    /** cube-face hue from the app (color = duration) */
    var hue: Double
    var totalSeconds: Double
}

private func cubeColor(_ hue: Double, _ brightness: Double = 0.82) -> Color {
    Color(hue: hue / 360, saturation: 0.62, brightness: brightness)
}

private func fmtSeconds(_ s: Double) -> String {
    let total = max(0, Int(s.rounded()))
    let h = total / 3600
    let m = (total % 3600) / 60
    let sec = total % 60
    return h > 0
        ? String(format: "%d:%02d:%02d", h, m, sec)
        : String(format: "%d:%02d", m, sec)
}

struct TimerActivityView: View {
    let context: ActivityViewContext<TimerActivityAttributes>

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(cubeColor(context.attributes.hue).opacity(0.28))
                Image(systemName: context.state.pausedRemaining != nil ? "pause.fill" : "timer")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(cubeColor(context.attributes.hue, 0.95))
            }
            .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 1) {
                Text(context.attributes.label)
                    .font(.system(size: 16, weight: .semibold))
                Text(context.state.pausedRemaining != nil ? "Paused" : "Timer")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if let paused = context.state.pausedRemaining {
                Text(fmtSeconds(paused))
                    .font(.system(size: 36, weight: .bold).monospacedDigit())
                    .foregroundStyle(.secondary)
            } else {
                Text(timerInterval: Date.now...max(Date.now, context.state.endAt), countsDown: true)
                    .font(.system(size: 36, weight: .bold).monospacedDigit())
                    .foregroundStyle(cubeColor(context.attributes.hue, 0.95))
                    .frame(maxWidth: 130, alignment: .trailing)
                    .multilineTextAlignment(.trailing)
            }
        }
        .padding(16)
    }
}

struct TimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TimerActivityAttributes.self) { context in
            TimerActivityView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 8) {
                        Image(systemName: "timer")
                            .foregroundStyle(cubeColor(context.attributes.hue, 0.95))
                        Text(context.attributes.label)
                            .font(.system(size: 15, weight: .semibold))
                    }
                    .padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let paused = context.state.pausedRemaining {
                        Text(fmtSeconds(paused))
                            .font(.system(size: 26, weight: .bold).monospacedDigit())
                            .foregroundStyle(.secondary)
                    } else {
                        Text(timerInterval: Date.now...max(Date.now, context.state.endAt), countsDown: true)
                            .font(.system(size: 26, weight: .bold).monospacedDigit())
                            .foregroundStyle(cubeColor(context.attributes.hue, 0.95))
                            .frame(maxWidth: 90, alignment: .trailing)
                    }
                }
            } compactLeading: {
                Image(systemName: "timer")
                    .foregroundStyle(cubeColor(context.attributes.hue, 0.95))
            } compactTrailing: {
                if let paused = context.state.pausedRemaining {
                    Text(fmtSeconds(paused))
                        .font(.system(size: 14, weight: .semibold).monospacedDigit())
                        .foregroundStyle(.secondary)
                } else {
                    Text(timerInterval: Date.now...max(Date.now, context.state.endAt), countsDown: true)
                        .font(.system(size: 14, weight: .semibold).monospacedDigit())
                        .foregroundStyle(cubeColor(context.attributes.hue, 0.95))
                        .frame(maxWidth: 52)
                }
            } minimal: {
                Image(systemName: "timer")
                    .foregroundStyle(cubeColor(context.attributes.hue, 0.95))
            }
        }
    }
}
