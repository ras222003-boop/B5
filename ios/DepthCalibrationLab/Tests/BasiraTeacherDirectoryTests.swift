import XCTest
@testable import BasiraDepthCalibrationLab

final class BasiraTeacherDirectoryTests: XCTestCase {
    private func temporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("basira-teacher-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    @MainActor
    private func expect(_ expected: BasiraTeacherDirectoryError,
                        file: StaticString = #filePath, line: UInt = #line,
                        _ operation: () throws -> Void) {
        XCTAssertThrowsError(try operation(), file: file, line: line) { error in
            guard let actual = error as? BasiraTeacherDirectoryError else {
                XCTFail("Unexpected error type", file: file, line: line)
                return
            }
            // The production enum deliberately has no associated values.
            XCTAssertEqual(String(describing: actual), String(describing: expected), file: file, line: line)
        }
    }

    @MainActor
    func testLocalContactsNormalizePersistReloadAndRemove() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = BasiraTeacherDirectoryStore(directory: directory)
        XCTAssertNil(store.startupError)
        try store.add(BasiraTeacherDraft(name: "  Test Teacher \n", email: " TEACHER@example.org ",
                                        course: " Mathematics ", organization: " Basira Test "))
        let saved = try XCTUnwrap(store.contacts.first)
        XCTAssertEqual(saved.name, "Test Teacher")
        XCTAssertEqual(saved.email, "teacher@example.org")
        XCTAssertEqual(saved.course, "Mathematics")
        XCTAssertEqual(saved.organization, "Basira Test")

        let reloaded = BasiraTeacherDirectoryStore(directory: directory)
        XCTAssertEqual(reloaded.contacts, [saved])
        let file = directory.appendingPathComponent("teacher-directory-v1.json")
        XCTAssertEqual(try file.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)

        try reloaded.remove(id: saved.id)
        XCTAssertTrue(reloaded.contacts.isEmpty)
        XCTAssertTrue(BasiraTeacherDirectoryStore(directory: directory).contacts.isEmpty)
    }

    @MainActor
    func testValidationAndDuplicateFailuresDoNotChangeStoredData() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = BasiraTeacherDirectoryStore(directory: directory)
        let valid = BasiraTeacherDraft(name: "Teacher", email: "teacher@example.org", course: "Math")
        try store.add(valid)
        let file = directory.appendingPathComponent("teacher-directory-v1.json")
        let before = try Data(contentsOf: file)
        let invalid: [(BasiraTeacherDraft, BasiraTeacherDirectoryError)] = [
            (BasiraTeacherDraft(name: " \n", email: valid.email, course: valid.course), .invalidName),
            (BasiraTeacherDraft(name: String(repeating: "a", count: 121), email: valid.email, course: valid.course), .invalidName),
            (BasiraTeacherDraft(name: valid.name, email: "not-an-email", course: valid.course), .invalidEmail),
            (BasiraTeacherDraft(name: valid.name, email: valid.email, course: " \n"), .invalidCourse),
            (BasiraTeacherDraft(name: valid.name, email: valid.email, course: String(repeating: "b", count: 181)), .invalidCourse),
            (BasiraTeacherDraft(name: valid.name, email: valid.email, course: valid.course,
                                organization: String(repeating: "c", count: 181)), .invalidOrganization),
            (BasiraTeacherDraft(name: "Another", email: "TEACHER@EXAMPLE.ORG", course: "MATH"), .duplicate)
        ]
        for (draft, reason) in invalid {
            expect(reason) { try store.add(draft) }
            XCTAssertEqual(try Data(contentsOf: file), before)
            XCTAssertEqual(store.contacts.count, 1)
        }
        // A teacher may be intentionally associated with a second course.
        try store.add(BasiraTeacherDraft(name: valid.name, email: valid.email, course: "Science"))
        XCTAssertEqual(store.contacts.count, 2)
    }

    @MainActor
    func testContactLimitPersistsWithoutAcceptingAnExtraRecord() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = BasiraTeacherDirectoryStore(directory: directory)
        for index in 0..<BasiraTeacherDirectoryStore.maximumContacts {
            try store.add(BasiraTeacherDraft(name: "Teacher \(index)", email: "teacher\(index)@example.org", course: "Math"))
        }
        expect(.full) {
            try store.add(BasiraTeacherDraft(name: "Extra", email: "extra@example.org", course: "Math"))
        }
        XCTAssertEqual(BasiraTeacherDirectoryStore(directory: directory).contacts.count,
                       BasiraTeacherDirectoryStore.maximumContacts)
    }

    @MainActor
    func testCorruptFileFailsClosedAndIsNotOverwritten() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("teacher-directory-v1.json")
        let corrupt = Data("{invalid local contact data".utf8)
        try corrupt.write(to: file)
        let store = BasiraTeacherDirectoryStore(directory: directory)
        XCTAssertNotNil(store.startupError)
        XCTAssertTrue(store.contacts.isEmpty)
        expect(.storageUnavailable) {
            try store.add(BasiraTeacherDraft(name: "Teacher", email: "teacher@example.org", course: "Math"))
        }
        XCTAssertEqual(try Data(contentsOf: file), corrupt)
    }

    @MainActor
    func testFailedPersistenceDoesNotMutateTheInMemoryDirectory() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = BasiraTeacherDirectoryStore(directory: directory)
        try store.add(BasiraTeacherDraft(name: "Teacher", email: "teacher@example.org", course: "Math"))
        let before = store.contacts
        // The app's protected storage becoming unavailable must not look like a
        // successful add or deletion. Only this test's private folder is removed.
        try FileManager.default.removeItem(at: directory)
        expect(.storageUnavailable) {
            try store.add(BasiraTeacherDraft(name: "Extra", email: "extra@example.org", course: "Math"))
        }
        XCTAssertEqual(store.contacts, before)
        expect(.storageUnavailable) { try store.remove(id: before[0].id) }
        XCTAssertEqual(store.contacts, before)
    }
}
