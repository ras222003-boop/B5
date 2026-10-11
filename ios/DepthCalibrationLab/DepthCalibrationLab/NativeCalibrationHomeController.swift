import UIKit

private struct DepthLabRecord: Codable {
    let targetMeters: Double
    let condition: String
    let capturedAt: String
    let measuredMeters: Double
    let confidence: Double
    let frameId: String
    let frameTimestampMs: Double
    let source: String
}

/// Standalone offline data collection for the iPhone 14 Pro camera's CENTER depth.
/// Does not compute object clearance or instruct anyone to walk.
final class NativeCalibrationHomeController: UIViewController {
    private let targets = [0.5, 1.0, 2.0, 3.0, 5.0]
    private let conditions = ["INDOOR_BRIGHT", "INDOOR_DIM", "OUTDOOR"]
    private let storageKey = "basira-lidar-lab-records-v1"
    private let targetPicker = UISegmentedControl(items: ["0.5", "1", "2", "3", "5"])
    private let conditionPicker = UISegmentedControl(items: ["إضاءة جيدة", "إضاءة خافتة", "خارج المبنى"])
    private let status = UILabel()
    private let report = UILabel()
    private var records: [DepthLabRecord] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.09, green: 0.10, blue: 0.12, alpha: 1)
        view.semanticContentAttribute = .forceRightToLeft
        if let bytes = UserDefaults.standard.data(forKey: storageKey),
           let saved = try? JSONDecoder().decode([DepthLabRecord].self, from: bytes) {
            records = saved
        }
        targetPicker.selectedSegmentIndex = 1
        conditionPicker.selectedSegmentIndex = 0
        targetPicker.accessibilityLabel = "اختر المسافة المرجعية بالأمتار"
        conditionPicker.accessibilityLabel = "اختر ظروف القياس"

        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 20
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)

        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 22),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -22),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40)
        ])

        let title = label("بصيرة | مختبر LiDAR", style: .largeTitle, bold: true)
        stack.addArrangedSubview(title)
        let warning = label("للاختبار البحثي على جهاز ثابت فقط. لا تمشِ أثناء القياس. هذه القراءات لا تتيح الملاحة الآمنة أو إرشاد الدرج.", style: .body)
        warning.textColor = .systemOrange
        stack.addArrangedSubview(warning)

        stack.addArrangedSubview(label("1. قِس المسافة من عدسة الكاميرا إلى سطح الهدف بشريط قياس.", style: .headline))
        stack.addArrangedSubview(label("2. حدد المسافة المرجعية:", style: .body))
        stack.addArrangedSubview(targetPicker)
        stack.addArrangedSubview(label("3. حدد ظروف الإضاءة:", style: .body))
        stack.addArrangedSubview(conditionPicker)
        stack.addArrangedSubview(label("4. ثبت الهاتف ووجّه علامة المنتصف نحو سطح ثابت ثم التقط قراءة.", style: .body))

        let live = button("الكاميرا مع أسماء الأجسام ومسافاتها (تجريبية)", selector: #selector(openNativeVision))
        stack.addArrangedSubview(live)

        let scan = button("التقاط قياس من LiDAR", selector: #selector(takeSample))
        stack.addArrangedSubview(scan)

        status.numberOfLines = 0
        status.textColor = .white
        status.font = .preferredFont(forTextStyle: .body)
        status.text = "جاهز للتجربة. لم يتم جمع قراءة في هذه الجلسة."
        status.accessibilityTraits = .staticText
        stack.addArrangedSubview(status)

        report.numberOfLines = 0
        report.textColor = .white
        report.font = .monospacedSystemFont(ofSize: 15, weight: .regular)
        report.accessibilityLabel = "ملخص القياسات التي سجلها المختبر"
        stack.addArrangedSubview(report)

        let export = button("تصدير البيانات CSV", selector: #selector(exportCSV))
        stack.addArrangedSubview(export)
        let clear = button("حذف جميع القياسات بعد التأكيد", selector: #selector(confirmClear))
        stack.addArrangedSubview(clear)

        let explanation = label("تُحفظ القياسات رقميًا على هذا الآيفون فقط حتى تصدّرها أو تمسحها. لا تحفظ بصيرة صور الكاميرا أو تُرسلها إلى الخادم في هذا المختبر.", style: .footnote)
        explanation.textColor = UIColor.lightGray
        stack.addArrangedSubview(explanation)
        refreshSummary()
    }

    private func label(_ text: String, style: UIFont.TextStyle, bold: Bool = false) -> UILabel {
        let item = UILabel()
        item.text = text
        item.numberOfLines = 0
        item.font = .preferredFont(forTextStyle: style)
        if bold { item.font = .systemFont(ofSize: 27, weight: .bold) }
        item.textColor = .white
        item.textAlignment = .natural
        item.adjustsFontForContentSizeCategory = true
        return item
    }

    private func button(_ title: String, selector: Selector) -> UIButton {
        let item = UIButton(type: .system)
        item.setTitle(title, for: .normal)
        item.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        item.titleLabel?.adjustsFontForContentSizeCategory = true
        item.tintColor = .black
        item.backgroundColor = UIColor(red: 0.96, green: 0.74, blue: 0.30, alpha: 1)
        item.layer.cornerRadius = 14
        item.contentEdgeInsets = UIEdgeInsets(top: 18, left: 14, bottom: 18, right: 14)
        item.addTarget(self, action: selector, for: .touchUpInside)
        item.accessibilityLabel = title
        return item
    }

    @objc private func openNativeVision() {
        let screen = NativeMetricVisionController()
        screen.modalPresentationStyle = .fullScreen
        present(screen, animated: true)
    }

    @objc private func takeSample() {
        let target = targets[targetPicker.selectedSegmentIndex]
        let condition = conditions[conditionPicker.selectedSegmentIndex]
        let reader = NativeLiDARCaptureController { [weak self] payload in
            guard let self else { return }
            guard let payload,
                  payload["source"] as? String == "ARKIT_DEPTH",
                  payload["capturedWithNativeSession"] as? Bool == true,
                  payload["alignedToCameraFrame"] as? Bool == true,
                  payload["rawDepthFresh"] as? Bool == true,
                  let measured = payload["distanceMeters"] as? Double,
                  let quality = payload["confidence"] as? Double,
                  let frameId = payload["frameId"] as? String,
                  let timestamp = payload["frameTimestampMs"] as? Double,
                  !frameId.isEmpty, timestamp.isFinite, timestamp > 0,
                  measured.isFinite, measured > 0, measured <= 10,
                  quality.isFinite, quality >= 0.7, quality <= 1 else {
                self.setStatus("لم تسجل قراءة؛ أُلغيت العملية أو تعذر التحقق من العمق.")
                return
            }
            let row = DepthLabRecord(targetMeters: target, condition: condition,
                                     capturedAt: ISO8601DateFormatter().string(from: Date()),
                                     measuredMeters: measured, confidence: quality,
                                     frameId: frameId, frameTimestampMs: timestamp,
                                     source: "ARKIT_DEPTH")
            self.records.append(row)
            self.persist()
            let error = abs(measured-target)
            self.setStatus(String(format: "المرجع %.2f متر، قراءة LiDAR %.3f متر، الخطأ المطلق %.3f متر. الجودة %.0f%%.", target, measured, error, quality*100))
            self.refreshSummary()
        }
        reader.modalPresentationStyle = .fullScreen
        present(reader, animated: true)
    }

    private func setStatus(_ message: String) {
        status.text = message
        UIAccessibility.post(notification: .announcement, argument: message)
    }

    private func persist() {
        if let bytes = try? JSONEncoder().encode(records) {
            UserDefaults.standard.set(bytes, forKey: storageKey)
        }
    }

    private func refreshSummary() {
        var rows = ["إجمالي القراءات المقبولة: \(records.count).", "المسافة | العينات | الوسيط للخطأ المطلق"]
        for target in targets {
            let errors = records.filter { $0.targetMeters == target }
                .map { abs($0.measuredMeters - target) }.sorted()
            let median = errors.isEmpty ? "—" : String(format: "%.3f م", errors[(errors.count - 1) / 2])
            rows.append("\(target) م | \(errors.count) | \(median)")
        }
        report.text = rows.joined(separator: "\n") + "\nهذه بيانات أولية وليست اعتمادًا لسلامة التنقل."
    }

    @objc private func exportCSV() {
        guard !records.isEmpty else {
            setStatus("لا توجد قياسات محفوظة لتصديرها.")
            return
        }
        let header = "reference_m,condition,date,measured_m,absolute_error_m,quality,source,frame_id,timestamp_ms"
        let lines = records.map { row in
            [String(row.targetMeters), row.condition, row.capturedAt,
             String(row.measuredMeters), String(abs(row.measuredMeters-row.targetMeters)),
             String(row.confidence), row.source, row.frameId, String(row.frameTimestampMs)]
                .joined(separator: ",")
        }
        let data = ([header] + lines).joined(separator: "\n")
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("basira-lidar-measurements.csv")
        do {
            try data.write(to: file, atomically: true, encoding: .utf8)
            present(UIActivityViewController(activityItems: [file], applicationActivities: nil),
                    animated: true)
        } catch {
            setStatus("تعذر تصدير ملف القياسات، جرّب مجددًا.")
        }
    }

    @objc private func confirmClear() {
        let dialog = UIAlertController(title: "حذف بيانات المختبر",
                                       message: "هل تريد حذف جميع القياسات المخزنة على هذا الجهاز؟",
                                       preferredStyle: .alert)
        dialog.addAction(UIAlertAction(title: "إلغاء", style: .cancel))
        dialog.addAction(UIAlertAction(title: "حذف", style: .destructive) { [weak self] _ in
            guard let self else { return }
            self.records.removeAll()
            self.persist()
            self.refreshSummary()
            self.setStatus("تم حذف قراءات المختبر من هذا الجهاز.")
        })
        present(dialog, animated: true)
    }
}
