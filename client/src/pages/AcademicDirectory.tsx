import { useEffect, useState } from "react";
import { Link } from "wouter";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import {
  deleteAcademicRecord,
  loadAcademicDirectory,
  writeAcademicRecord,
  type AcademicDirectory,
  type Course,
  type Teacher,
} from "@/lib/academicDirectory";

const words = {
  ar: {
    title: "المعلمون والمقررات",
    intro:
      "احفظ المعلمين والمقررات في حسابك لاختيار المستلم الصحيح عند إرسال الاختبار.",
    teacher: "المعلم",
    teachers: "المعلمون",
    course: "المقرر",
    courses: "المقررات",
    name: "الاسم",
    email: "البريد الإلكتروني",
    institution: "المؤسسة التعليمية",
    notes: "ملاحظات",
    code: "رمز المقرر",
    linked: "المعلمون المرتبطون",
    default: "المعلم الافتراضي",
    none: "بدون",
    add: "إضافة",
    save: "حفظ",
    edit: "تعديل",
    remove: "حذف",
    cancel: "إلغاء",
    search: "ابحث عن معلم أو مقرر",
    empty: "لا توجد نتائج",
    login: "سجّل الدخول لعرض دفتر المعلمين والمقررات.",
    loadError: "تعذر تحميل الدفتر.",
    saved: "حُفظت البيانات.",
    deleted: "حُذفت البيانات.",
    error: "تعذر حفظ البيانات. تحقق من الحقول وحاول مجددًا.",
    confirm: "هل تريد حذف هذا السجل؟",
    back: "العودة إلى الاختبارات",
  },
  en: {
    title: "Teachers and courses",
    intro:
      "Save teachers and courses in your account to choose the right recipient for an exam.",
    teacher: "Teacher",
    teachers: "Teachers",
    course: "Course",
    courses: "Courses",
    name: "Name",
    email: "Email",
    institution: "Institution",
    notes: "Notes",
    code: "Course code",
    linked: "Linked teachers",
    default: "Default teacher",
    none: "None",
    add: "Add",
    save: "Save",
    edit: "Edit",
    remove: "Delete",
    cancel: "Cancel",
    search: "Search teachers or courses",
    empty: "No results",
    login: "Sign in to view your teachers and courses.",
    loadError: "Could not load the directory.",
    saved: "Saved.",
    deleted: "Deleted.",
    error: "Could not save. Check the fields and try again.",
    confirm: "Delete this record?",
    back: "Back to exams",
  },
  "zh-CN": {
    title: "教师与课程",
    intro: "将教师和课程保存在账户中，以便发送考试时选择正确的收件人。",
    teacher: "教师",
    teachers: "教师",
    course: "课程",
    courses: "课程",
    name: "名称",
    email: "电子邮箱",
    institution: "学校",
    notes: "备注",
    code: "课程代码",
    linked: "关联教师",
    default: "默认教师",
    none: "无",
    add: "添加",
    save: "保存",
    edit: "编辑",
    remove: "删除",
    cancel: "取消",
    search: "搜索教师或课程",
    empty: "没有结果",
    login: "请登录以查看教师与课程。",
    loadError: "无法加载目录。",
    saved: "已保存。",
    deleted: "已删除。",
    error: "无法保存，请检查字段后重试。",
    confirm: "删除此记录？",
    back: "返回考试",
  },
} as const;
const input =
  "min-h-12 w-full rounded-lg border border-amber-200/40 bg-stone-950 px-3 text-amber-50";
const button =
  "min-h-12 rounded-lg border border-amber-300/60 px-4 py-2 text-amber-100 hover:bg-amber-300/10";
const blankTeacher = { name: "", email: "", institution: "", notes: "" };
const blankCourse = {
  name: "",
  code: "",
  institution: "",
  notes: "",
  teacherIds: [] as string[],
  defaultTeacherId: null as string | null,
};

export default function AcademicDirectoryPage() {
  const { lang } = useI18n(),
    t = words[lang];
  const [data, setData] = useState<AcademicDirectory>({
    teachers: [],
    courses: [],
  });
  const [teacher, setTeacher] = useState(blankTeacher),
    [teacherId, setTeacherId] = useState<string | null>(null);
  const [course, setCourse] = useState(blankCourse),
    [courseId, setCourseId] = useState<string | null>(null);
  const [search, setSearch] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    const result = await loadAcademicDirectory();
    setData(result);
  };
  useEffect(() => {
    void refresh().catch(error =>
      setNotice(
        error instanceof Error && error.message === "login_required"
          ? t.login
          : t.loadError
      )
    );
  }, [t.login, t.loadError]);
  const saveTeacher = async () => {
    setBusy(true);
    setNotice("");
    try {
      await writeAcademicRecord("teachers", teacher, teacherId ?? undefined);
      await refresh();
      setTeacher(blankTeacher);
      setTeacherId(null);
      setNotice(t.saved);
    } catch {
      setNotice(t.error);
    } finally {
      setBusy(false);
    }
  };
  const saveCourse = async () => {
    setBusy(true);
    setNotice("");
    try {
      await writeAcademicRecord("courses", course, courseId ?? undefined);
      await refresh();
      setCourse(blankCourse);
      setCourseId(null);
      setNotice(t.saved);
    } catch {
      setNotice(t.error);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (kind: "teachers" | "courses", id: string) => {
    if (!window.confirm(t.confirm)) return;
    setBusy(true);
    try {
      await deleteAcademicRecord(kind, id);
      await refresh();
      setNotice(t.deleted);
    } catch {
      setNotice(t.error);
    } finally {
      setBusy(false);
    }
  };
  const matches = (...values: string[]) =>
    values
      .join(" ")
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase());
  const filteredTeachers = data.teachers.filter(item =>
    matches(item.name, item.email, item.institution)
  );
  const filteredCourses = data.courses.filter(item =>
    matches(
      item.name,
      item.code,
      item.institution,
      ...item.teacherIds.map(
        id => data.teachers.find(teacher => teacher.id === id)?.name ?? ""
      )
    )
  );
  return (
    <Layout>
      <main className="container max-w-5xl space-y-6 py-8 text-stone-100">
        <Link href="/online-exams" className="text-amber-300 underline">
          {t.back}
        </Link>
        <header>
          <h1 className="text-3xl font-black">{t.title}</h1>
          <p className="mt-2 text-stone-300">{t.intro}</p>
        </header>
        <p role="status" aria-live="polite">
          {notice}
        </p>
        <label className="block max-w-xl">
          {t.search}
          <input
            className={input}
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </label>
        <div className="grid gap-6 lg:grid-cols-2">
          <section
            className="space-y-4 rounded-xl border border-amber-200/30 p-5"
            aria-labelledby="teachers-title"
          >
            <h2 id="teachers-title" className="text-2xl font-bold">
              {t.teachers}
            </h2>
            <form
              className="space-y-3"
              onSubmit={event => {
                event.preventDefault();
                void saveTeacher();
              }}
            >
              <label className="block">
                {t.name}
                <input
                  className={input}
                  required
                  maxLength={120}
                  value={teacher.name}
                  onChange={event =>
                    setTeacher({ ...teacher, name: event.target.value })
                  }
                />
              </label>
              <label className="block">
                {t.email}
                <input
                  className={input}
                  required
                  type="email"
                  dir="ltr"
                  maxLength={254}
                  value={teacher.email}
                  onChange={event =>
                    setTeacher({ ...teacher, email: event.target.value })
                  }
                />
              </label>
              <label className="block">
                {t.institution}
                <input
                  className={input}
                  maxLength={180}
                  value={teacher.institution}
                  onChange={event =>
                    setTeacher({ ...teacher, institution: event.target.value })
                  }
                />
              </label>
              <label className="block">
                {t.notes}
                <textarea
                  className={input}
                  maxLength={1000}
                  value={teacher.notes}
                  onChange={event =>
                    setTeacher({ ...teacher, notes: event.target.value })
                  }
                />
              </label>
              <button className={button} disabled={busy} type="submit">
                {teacherId ? t.save : t.add} {t.teacher}
              </button>
              {teacherId && (
                <button
                  className={`${button} ms-2`}
                  type="button"
                  onClick={() => {
                    setTeacher(blankTeacher);
                    setTeacherId(null);
                  }}
                >
                  {t.cancel}
                </button>
              )}
            </form>
            {filteredTeachers.length ? (
              <ul className="space-y-3">
                {filteredTeachers.map(item => (
                  <li
                    key={item.id}
                    className="rounded-lg border border-amber-200/20 p-3"
                  >
                    <strong>{item.name}</strong>
                    <p dir="ltr" className="break-all">
                      {item.email}
                    </p>
                    {item.institution && <p>{item.institution}</p>}
                    <div className="mt-2 flex gap-2">
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() => {
                          setTeacher({
                            name: item.name,
                            email: item.email,
                            institution: item.institution,
                            notes: item.notes,
                          });
                          setTeacherId(item.id);
                        }}
                      >
                        {t.edit}
                      </button>
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() => void remove("teachers", item.id)}
                      >
                        {t.remove}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t.empty}</p>
            )}
          </section>
          <section
            className="space-y-4 rounded-xl border border-amber-200/30 p-5"
            aria-labelledby="courses-title"
          >
            <h2 id="courses-title" className="text-2xl font-bold">
              {t.courses}
            </h2>
            <form
              className="space-y-3"
              onSubmit={event => {
                event.preventDefault();
                void saveCourse();
              }}
            >
              <label className="block">
                {t.name}
                <input
                  className={input}
                  required
                  maxLength={180}
                  value={course.name}
                  onChange={event =>
                    setCourse({ ...course, name: event.target.value })
                  }
                />
              </label>
              <label className="block">
                {t.code}
                <input
                  className={input}
                  maxLength={40}
                  value={course.code}
                  onChange={event =>
                    setCourse({ ...course, code: event.target.value })
                  }
                />
              </label>
              <label className="block">
                {t.institution}
                <input
                  className={input}
                  maxLength={180}
                  value={course.institution}
                  onChange={event =>
                    setCourse({ ...course, institution: event.target.value })
                  }
                />
              </label>
              <label className="block">
                {t.notes}
                <textarea
                  className={input}
                  maxLength={1000}
                  value={course.notes}
                  onChange={event =>
                    setCourse({ ...course, notes: event.target.value })
                  }
                />
              </label>
              <fieldset className="space-y-2">
                <legend>{t.linked}</legend>
                {data.teachers.map(item => (
                  <label key={item.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={course.teacherIds.includes(item.id)}
                      onChange={event =>
                        setCourse(previous => {
                          const teacherIds = event.target.checked
                            ? [...previous.teacherIds, item.id]
                            : previous.teacherIds.filter(id => id !== item.id);
                          return {
                            ...previous,
                            teacherIds,
                            defaultTeacherId: teacherIds.includes(
                              previous.defaultTeacherId ?? ""
                            )
                              ? previous.defaultTeacherId
                              : null,
                          };
                        })
                      }
                    />
                    {item.name} · {item.email}
                  </label>
                ))}
              </fieldset>
              <label className="block">
                {t.default}
                <select
                  className={input}
                  value={course.defaultTeacherId ?? ""}
                  onChange={event =>
                    setCourse({
                      ...course,
                      defaultTeacherId: event.target.value || null,
                    })
                  }
                >
                  <option value="">{t.none}</option>
                  {data.teachers
                    .filter(item => course.teacherIds.includes(item.id))
                    .map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
              <button className={button} disabled={busy} type="submit">
                {courseId ? t.save : t.add} {t.course}
              </button>
              {courseId && (
                <button
                  className={`${button} ms-2`}
                  type="button"
                  onClick={() => {
                    setCourse(blankCourse);
                    setCourseId(null);
                  }}
                >
                  {t.cancel}
                </button>
              )}
            </form>
            {filteredCourses.length ? (
              <ul className="space-y-3">
                {filteredCourses.map(item => (
                  <li
                    key={item.id}
                    className="rounded-lg border border-amber-200/20 p-3"
                  >
                    <strong>{item.name}</strong>
                    {item.code && <span> · {item.code}</span>}
                    <p>
                      {item.teacherIds
                        .map(
                          id =>
                            data.teachers.find(teacher => teacher.id === id)
                              ?.name
                        )
                        .filter(Boolean)
                        .join("، ") || t.none}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() => {
                          setCourse({
                            name: item.name,
                            code: item.code,
                            institution: item.institution,
                            notes: item.notes,
                            teacherIds: item.teacherIds,
                            defaultTeacherId: item.defaultTeacherId,
                          });
                          setCourseId(item.id);
                        }}
                      >
                        {t.edit}
                      </button>
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() => void remove("courses", item.id)}
                      >
                        {t.remove}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t.empty}</p>
            )}
          </section>
        </div>
      </main>
    </Layout>
  );
}
