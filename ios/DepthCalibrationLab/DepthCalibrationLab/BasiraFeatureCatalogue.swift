import Foundation

/// User-facing Basira routes that already exist in client/src/App.tsx.
/// A route makes an existing web feature reachable; it does not certify it
/// as safe, deployed, or usable without a backend/account/network.
enum BasiraFeature: String, CaseIterable, Identifiable, Hashable {
    case vision
    case metricVisionWeb
    case navigation
    case guidance
    case places
    case mapping
    case sharedMap
    case indoorManager
    case navigationAdmin
    case navigationPermissions
    case navigationCapabilities
    case onlineExams
    case examDemo
    case teacher
    case assistant
    case aiGuide
    case account
    case voiceSettings
    case voiceValidation
    case support
    case privacy
    case terms
    case robotics
    case arLabs
    case arImageTargets
    case arFace
    case arSky
    case arVenues
    case arWorld
    case arWorldScale
    case assistantAnalytics
    case photoRequirements
    case howItWorks
    case features
    case about
    case contact
    case refundPolicy

    var id: String { rawValue }

    var path: String {
        switch self {
        case .vision: return "/navigation/vision"
        case .metricVisionWeb: return "/navigation/native-vision"
        case .navigation: return "/navigation"
        case .guidance: return "/navigation/guidance"
        case .places: return "/navigation/places"
        case .mapping: return "/navigation/mapping"
        case .sharedMap: return "/navigation/shared-map"
        case .indoorManager: return "/navigation/indoor-manager"
        case .navigationAdmin: return "/navigation/admin"
        case .navigationPermissions: return "/navigation/permissions"
        case .navigationCapabilities: return "/navigation/capabilities"
        case .onlineExams: return "/online-exams"
        case .examDemo: return "/exam-demo"
        case .teacher: return "/teacher"
        case .assistant: return "/assistant"
        case .aiGuide: return "/ai-guide"
        case .account: return "/account"
        case .voiceSettings: return "/settings/voice"
        case .voiceValidation: return "/settings/voice-validation"
        case .support: return "/support"
        case .privacy: return "/privacy"
        case .terms: return "/terms"
        case .robotics: return "/robotic-arm"
        case .arLabs: return "/navigation/ar-lab"
        case .arImageTargets: return "/navigation/ar-lab/image-targets"
        case .arFace: return "/navigation/ar-lab/face"
        case .arSky: return "/navigation/ar-lab/sky"
        case .arVenues: return "/navigation/ar-lab/venues"
        case .arWorld: return "/navigation/ar-lab/world"
        case .arWorldScale: return "/navigation/ar-lab/world-scale-sandbox"
        case .assistantAnalytics: return "/assistant-analytics"
        case .photoRequirements: return "/photo-requirements"
        case .howItWorks: return "/how-it-works"
        case .features: return "/features"
        case .about: return "/about"
        case .contact: return "/contact"
        case .refundPolicy: return "/refund-policy"
        }
    }

    var name: String {
        switch self {
        case .vision: return "الرؤية ووصف المكان"
        case .metricVisionWeb: return "مختبر الرؤية المترية على الويب"
        case .navigation: return "الخرائط والتنقل"
        case .guidance: return "الإرشاد المكاني التجريبي"
        case .places: return "أماكني المحفوظة"
        case .mapping: return "رسم الخرائط"
        case .sharedMap: return "الخريطة المجتمعية"
        case .indoorManager: return "إدارة خرائط المباني"
        case .navigationAdmin: return "إدارة الملاحة"
        case .navigationPermissions: return "الخصوصية والأذونات"
        case .navigationCapabilities: return "قدرات الملاحة وحدودها"
        case .onlineExams: return "الاختبارات التعليمية"
        case .examDemo: return "تجربة الاختبارات"
        case .teacher: return "لوحة المعلم"
        case .assistant: return "المساعد الرقمي"
        case .aiGuide: return "الدليل الذكي"
        case .account: return "حسابي"
        case .voiceSettings: return "إعدادات الصوت"
        case .voiceValidation: return "اختبار الأصوات"
        case .support: return "الدعم"
        case .privacy: return "سياسة الخصوصية"
        case .terms: return "الشروط"
        case .robotics: return "الذراع الروبوتية"
        case .arLabs: return "مختبرات الواقع المعزز"
        case .arImageTargets: return "تجارب الصور المكانية"
        case .arFace: return "تجارب AR للوجه"
        case .arSky: return "تجارب AR للسماء"
        case .arVenues: return "تجهيز الأماكن للواقع المعزز"
        case .arWorld: return "جاهزية العالم المكاني"
        case .arWorldScale: return "مختبر المقياس المكاني"
        case .assistantAnalytics: return "تحليلات المساعد"
        case .photoRequirements: return "متطلبات الصور"
        case .howItWorks: return "كيف تعمل بصيرة"
        case .features: return "التعريف بالمزايا"
        case .about: return "عن بصيرة"
        case .contact: return "تواصل معنا"
        case .refundPolicy: return "سياسة الاسترداد"
        }
    }

    var detail: String {
        switch self {
        case .vision: return "كشف الأشياء ووصف المشاهد وقراءة النص والتنبيهات التجريبية"
        case .metricVisionWeb: return "واجهة ويب تجريبية مختلفة عن تبويب قياس LiDAR الأصلي"
        case .navigation: return "عرض المباني والوجهات والخرائط المتاحة"
        case .guidance: return "مساعدة استكشافية، وليست تصريحًا بالمشي أو ضمان تجنب الاصطدام"
        case .onlineExams: return "وظائف الاختبارات المنشورة في منصة بصيرة"
        case .teacher: return "وظائف المعلم وفق صلاحيات الحساب"
        case .mapping, .sharedMap, .indoorManager, .navigationAdmin:
            return "تتطلب بيانات و/أو صلاحيات مناسبة"
        case .robotics: return "صفحة التعريف بالذراع؛ لا تعني اتصال الأجهزة"
        case .arLabs, .arImageTargets, .arFace, .arSky, .arVenues, .arWorld, .arWorldScale:
            return "مختبر بحثي، وليس وظيفة ملاحة معتمدة"
        case .assistantAnalytics: return "للحسابات ذات صلاحيات التحليلات"
        default: return "افتح الخدمة الموجودة في منصة بصيرة"
        }
    }

    var symbol: String {
        switch self {
        case .vision, .metricVisionWeb: return "eye"
        case .navigation, .guidance: return "map"
        case .places: return "mappin.circle"
        case .mapping, .sharedMap: return "square.on.square"
        case .indoorManager, .navigationAdmin: return "building.2"
        case .navigationPermissions, .privacy: return "hand.raised"
        case .navigationCapabilities: return "info.circle"
        case .onlineExams, .examDemo: return "doc.text"
        case .teacher: return "person.crop.rectangle.stack"
        case .assistant, .aiGuide: return "waveform"
        case .account: return "person.crop.circle"
        case .voiceSettings, .voiceValidation: return "speaker.wave.2"
        case .support: return "questionmark.circle"
        case .terms: return "doc.plaintext"
        case .robotics: return "gearshape.2"
        case .arLabs, .arImageTargets, .arFace, .arSky, .arVenues, .arWorld, .arWorldScale:
            return "cube.transparent"
        case .assistantAnalytics: return "chart.bar"
        case .photoRequirements: return "photo"
        case .howItWorks, .features, .about: return "info.circle"
        case .contact: return "envelope"
        case .refundPolicy: return "doc.plaintext"
        }
    }

    static let everyday: [BasiraFeature] = [
        .vision, .navigation, .guidance, .places, .onlineExams,
        .assistant, .aiGuide, .voiceSettings
    ]
    static let maps: [BasiraFeature] = [
        .navigation, .guidance, .places, .mapping, .sharedMap, .navigationCapabilities
    ]
    static let education: [BasiraFeature] = [.onlineExams, .examDemo, .teacher, .photoRequirements]
    static let administration: [BasiraFeature] = [.indoorManager, .navigationAdmin, .assistantAnalytics]
    static let settings: [BasiraFeature] = [
        .account, .voiceSettings, .voiceValidation, .navigationPermissions,
        .support, .contact, .privacy, .terms, .refundPolicy, .about, .howItWorks, .features
    ]
    static let research: [BasiraFeature] = [
        .robotics, .metricVisionWeb, .arLabs, .arImageTargets, .arFace, .arSky, .arVenues, .arWorld, .arWorldScale
    ]
}

/// Production web origin is injected by the build, never guessed from a preview
/// or obtained from user-editable web content. Native camera bridges must only
/// attach to the approved host.
enum BasiraWebOrigin {
    static var baseURL: URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "BasiraWebBaseURL") as? String
        else { return nil }
        return validate(raw)
    }

    static func validate(_ raw: String) -> URL? {
        let candidate = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parts = URLComponents(string: candidate),
              parts.scheme?.lowercased() == "https",
              let host = parts.host?.lowercased(),
              !host.isEmpty, host != "localhost",
              !host.hasSuffix(".example"), !host.hasSuffix(".local"),
              parts.user == nil, parts.password == nil,
              parts.port == nil,
              (parts.path.isEmpty || parts.path == "/"),
              parts.query == nil, parts.fragment == nil
        else { return nil }
        return URL(string: "https://" + host)
    }

    static func url(for feature: BasiraFeature) -> URL? {
        guard let baseURL else { return nil }
        return URL(string: feature.path, relativeTo: baseURL)?.absoluteURL
    }

    static func allows(_ candidate: URL, within base: URL) -> Bool {
        candidate.scheme?.lowercased() == "https"
            && candidate.host?.lowercased() == base.host?.lowercased()
            && (candidate.port == nil || candidate.port == 443)
            && candidate.user == nil && candidate.password == nil
    }
}
