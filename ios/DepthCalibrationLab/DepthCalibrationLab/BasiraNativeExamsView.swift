import SwiftUI

/// An accessible native preparation screen. SMTP never runs on the iPhone:
/// real delivery will require authenticated backend endpoints and an approved PDF.
struct BasiraNativeExamsView: View {
    @StateObject private var directory = BasiraTeacherDirectoryStore()
    @State private var draft = BasiraTeacherDraft()
    @State private var consent = false
    @State private var selectedIDs: Set<UUID> = []
    @State private var pendingDeletion: BasiraTeacherContact?
    @State private var notice: String?
    @State private var noticeIsError = false

    private var selectedContacts: [BasiraTeacherContact] {
        directory.contacts.filter { selectedIDs.contains($0.id) }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("جهّز بيانات المعلمين قبل بدء الاختبار.", systemImage: "person.crop.rectangle.stack")
                        .font(.headline)
                    Text("هذا الدليل محفوظ على جهاز iPhone الحالي فقط، ولا يتزامن مع حساب بصيرة بعد.")
                        .foregroundStyle(.secondary)
                    Text("حفظ بريد المعلم لا يرسل أي اختبار أو رسالة.")
                        .foregroundStyle(.secondary)
                } header: {
                    Text("دليل المعلمين")
                }

                Section("إضافة معلم") {
                    TextField("اسم المعلم", text: $draft.name)
                        .textContentType(.name)
                        .accessibilityLabel("اسم المعلم")
                    TextField("البريد الإلكتروني للمعلم", text: $draft.email)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityLabel("البريد الإلكتروني للمعلم")
                    TextField("المقرر الدراسي", text: $draft.course)
                        .accessibilityLabel("المقرر الدراسي")
                    TextField("الجهة التعليمية، اختياري", text: $draft.organization)
                        .accessibilityLabel("الجهة التعليمية، اختياري")
                    Toggle("أوافق على حفظ بيانات تواصل المعلم على هذا الجهاز", isOn: $consent)
                    Button {
                        saveTeacher()
                    } label: {
                        Label("حفظ المعلم", systemImage: "person.crop.circle.badge.plus")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!consent || directory.contacts.count >= BasiraTeacherDirectoryStore.maximumContacts || directory.startupError != nil)
                    .accessibilityHint("يحفظ المعلم محليًا دون إرسال أي رسالة")
                }

                Section {
                    if directory.contacts.isEmpty {
                        Text("لم تضف أي معلم بعد.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(directory.contacts) { teacher in
                            VStack(alignment: .leading, spacing: 10) {
                                Text(teacher.name)
                                    .font(.headline)
                                Text(teacher.email)
                                    .textSelection(.enabled)
                                    .font(.subheadline)
                                    .accessibilityLabel("البريد الإلكتروني: \(teacher.email)")
                                Text(teacher.course + (teacher.organization.isEmpty ? "" : " · " + teacher.organization))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                HStack {
                                    Button {
                                        toggleSelection(teacher.id)
                                    } label: {
                                        Label(
                                            selectedIDs.contains(teacher.id) ? "إلغاء الاختيار" : "اختيار المعلم",
                                            systemImage: selectedIDs.contains(teacher.id) ? "checkmark.circle.fill" : "circle"
                                        )
                                        .frame(minHeight: 44)
                                    }
                                    .disabled(!selectedIDs.contains(teacher.id) && selectedIDs.count >= 5)
                                    .buttonStyle(.bordered)
                                    Spacer()
                                    Button(role: .destructive) {
                                        pendingDeletion = teacher
                                    } label: {
                                        Label("حذف", systemImage: "trash")
                                            .frame(minHeight: 44)
                                    }
                                    .buttonStyle(.bordered)
                                    .accessibilityLabel("حذف المعلم \(teacher.name)")
                                }
                            }
                            .padding(.vertical, 5)
                        }
                    }
                } header: {
                    Text("المعلمون المحفوظون · \(directory.contacts.count) من 20")
                } footer: {
                    Text("يمكنك اختيار خمسة مستلمين كحد أقصى لتجهيزهم لخطوة إرسال الاختبار لاحقًا.")
                }

                Section {
                    if selectedContacts.isEmpty {
                        Text("اختر معلمًا محفوظًا لتجهيزه كمستلم للاختبار.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(selectedContacts) { teacher in
                            Text("\(teacher.name) · \(teacher.email)")
                                .font(.subheadline)
                        }
                    }
                    Label("إرسال PDF عبر SMTP غير مفعّل في نسخة iPhone الحالية.", systemImage: "lock.shield")
                        .foregroundStyle(.orange)
                        .accessibilityLabel("الإرسال غير متاح بعد")
                    Text("يلزم أولًا تسجيل دخول آمن، وإنشاء نسخة اختبار نهائية معتمدة، وربطها بخادم البريد. لن نضع كلمات مرور SMTP في التطبيق.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } header: {
                    Text("إرسال الاختبار للمعلم")
                }

                if let startupError = directory.startupError {
                    Section {
                        Label(startupError, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                            .accessibilityAddTraits(.isStaticText)
                    }
                }

                if let notice {
                    Section {
                        Text(notice)
                            .foregroundStyle(noticeIsError ? .red : .green)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                }
            }
            .navigationTitle("اختبارات بصيرة")
            .confirmationDialog(
                "حذف بيانات هذا المعلم من الجهاز؟",
                isPresented: Binding(
                    get: { pendingDeletion != nil },
                    set: { if !$0 { pendingDeletion = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("حذف المعلم", role: .destructive) {
                    if let id = pendingDeletion?.id {
                        deleteTeacher(id: id)
                    }
                    pendingDeletion = nil
                }
                Button("إلغاء", role: .cancel) { pendingDeletion = nil }
            }
        }
    }

    private func toggleSelection(_ id: UUID) {
        if selectedIDs.contains(id) {
            selectedIDs.remove(id)
        } else if selectedIDs.count < 5 {
            selectedIDs.insert(id)
        }
    }

    private func saveTeacher() {
        guard consent else { return }
        do {
            try directory.add(draft)
            draft = BasiraTeacherDraft()
            consent = false
            noticeIsError = false
            notice = "تم حفظ المعلم على هذا الجهاز."
        } catch {
            noticeIsError = true
            notice = error.localizedDescription
        }
    }

    private func deleteTeacher(id: UUID) {
        do {
            try directory.remove(id: id)
            selectedIDs.remove(id)
            noticeIsError = false
            notice = "تم حذف المعلم."
        } catch {
            noticeIsError = true
            notice = error.localizedDescription
        }
    }
}
