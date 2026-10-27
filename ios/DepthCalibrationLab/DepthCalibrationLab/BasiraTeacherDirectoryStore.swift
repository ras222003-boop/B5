import Foundation
import Combine

/// Contact details are saved on this iPhone only. They are NOT an authenticated
/// Basira account directory and are NOT sent to any email provider.
struct BasiraTeacherContact: Codable, Identifiable, Equatable {
    let id: UUID
    let name: String
    let email: String
    let course: String
    let organization: String
    let savedAt: Date
}

struct BasiraTeacherDraft {
    var name = ""
    var email = ""
    var course = ""
    var organization = ""
}

enum BasiraTeacherDirectoryError: LocalizedError {
    case invalidName
    case invalidEmail
    case invalidCourse
    case invalidOrganization
    case duplicate
    case full
    case storageUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidName: return "أدخل اسم المعلم، بحد أقصى 120 حرفًا."
        case .invalidEmail: return "أدخل بريدًا إلكترونيًا صحيحًا للمعلم."
        case .invalidCourse: return "أدخل اسم المقرر، بحد أقصى 180 حرفًا."
        case .invalidOrganization: return "اسم الجهة أطول من الحد المسموح."
        case .duplicate: return "هذا البريد محفوظ بالفعل في المقرر نفسه."
        case .full: return "يمكن حفظ 20 معلمًا كحد أقصى."
        case .storageUnavailable: return "تعذر الوصول إلى التخزين المحمي. لم تُحفظ التغييرات."
        }
    }
}

@MainActor
final class BasiraTeacherDirectoryStore: ObservableObject {
    static let maximumContacts = 20
    @Published private(set) var contacts: [BasiraTeacherContact] = []
    @Published private(set) var startupError: String?

    private let fileURL: URL
    private var canPersist = true

    init(directory: URL? = nil) {
        let folder = directory ?? FileManager.default.urls(
            for: .applicationSupportDirectory, in: .userDomainMask
        )[0].appendingPathComponent("Basira", isDirectory: true)
        fileURL = folder.appendingPathComponent("teacher-directory-v1.json", isDirectory: false)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: fileURL.path) {
                let data = try Data(contentsOf: fileURL)
                contacts = try JSONDecoder().decode([BasiraTeacherContact].self, from: data)
            }
        } catch {
            canPersist = false
            startupError = "تعذر قراءة دليل المعلمين المحلي. لن تُستبدل البيانات قبل إصلاح المشكلة."
        }
    }

    func add(_ draft: BasiraTeacherDraft) throws {
        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let email = draft.email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let course = draft.course.trimmingCharacters(in: .whitespacesAndNewlines)
        let organization = draft.organization.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 120 else { throw BasiraTeacherDirectoryError.invalidName }
        guard Self.validEmail(email) else { throw BasiraTeacherDirectoryError.invalidEmail }
        guard !course.isEmpty, course.count <= 180 else { throw BasiraTeacherDirectoryError.invalidCourse }
        guard organization.count <= 180 else { throw BasiraTeacherDirectoryError.invalidOrganization }
        guard contacts.count < Self.maximumContacts else { throw BasiraTeacherDirectoryError.full }
        guard !contacts.contains(where: {
            $0.email.caseInsensitiveCompare(email) == .orderedSame &&
            $0.course.caseInsensitiveCompare(course) == .orderedSame
        }) else { throw BasiraTeacherDirectoryError.duplicate }

        let item = BasiraTeacherContact(
            id: UUID(), name: name, email: email, course: course,
            organization: organization, savedAt: Date()
        )
        let updated = [item] + contacts
        try persist(updated)
        contacts = updated
    }

    func remove(id: UUID) throws {
        let updated = contacts.filter { $0.id != id }
        guard updated.count != contacts.count else { return }
        try persist(updated)
        contacts = updated
    }

    private func persist(_ updated: [BasiraTeacherContact]) throws {
        guard canPersist else { throw BasiraTeacherDirectoryError.storageUnavailable }
        do {
            let data = try JSONEncoder().encode(updated)
            try data.write(to: fileURL, options: [.atomic, .completeFileProtection])
            // The contact list is local preparation data, not an account backup or cloud sync.
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try fileURL.setResourceValues(values)
        } catch {
            throw BasiraTeacherDirectoryError.storageUnavailable
        }
    }

    private static func validEmail(_ email: String) -> Bool {
        guard email.count <= 254, email.count >= 6 else { return false }
        let pattern = "^[A-Z0-9a-z.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9a-z-]+(\\.[A-Z0-9a-z-]+)+$"
        return email.range(of: pattern, options: .regularExpression) != nil
    }
}
