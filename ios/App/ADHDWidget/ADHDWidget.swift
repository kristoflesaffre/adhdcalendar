import WidgetKit
import SwiftUI

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
    }
}
