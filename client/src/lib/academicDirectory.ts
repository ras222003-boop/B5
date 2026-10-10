export type Teacher = {
  id: string;
  name: string;
  email: string;
  institution: string;
  notes: string;
};
export type Course = {
  id: string;
  name: string;
  code: string;
  institution: string;
  notes: string;
  teacherIds: string[];
  defaultTeacherId: string | null;
};
export type AcademicDirectory = { teachers: Teacher[]; courses: Course[] };
export async function loadAcademicDirectory(): Promise<AcademicDirectory> {
  const response = await fetch("/api/academics", {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      response.status === 401 ? "login_required" : "directory_unavailable"
    );
  return response.json() as Promise<AcademicDirectory>;
}
export async function writeAcademicRecord(
  kind: "teachers" | "courses",
  value: object,
  id?: string
): Promise<void> {
  const response = await fetch(`/api/academics/${kind}${id ? `/${id}` : ""}`, {
    method: id ? "PUT" : "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error("save_failed");
}
export async function deleteAcademicRecord(
  kind: "teachers" | "courses",
  id: string
): Promise<void> {
  const response = await fetch(`/api/academics/${kind}/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw new Error("delete_failed");
}
