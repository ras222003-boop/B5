/** Real local browser flow; creates one temporary account and removes it afterward. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";
import { createPool } from "mysql2/promise";

const base = process.env.BASIRA_TEST_URL ?? "http://localhost:3000";
const email = `basira-directory-${randomBytes(8).toString("hex")}@example.test`;
const password = randomBytes(24).toString("base64url");
const name = "طالب الدفتر";
const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "ar-SA",
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
let userId: string | undefined;
const open = async (path: string) => {
  await page.goto(`${base}${path}`);
  const skip = page.locator('[data-testid="welcome-skip"]');
  if (await skip.count()) await skip.click();
};
try {
  await open("/account");
  await page.getByRole("tab", { name: "إنشاء حساب" }).click();
  await page.getByLabel("الاسم", { exact: true }).fill(name);
  await page.getByLabel("البريد الإلكتروني", { exact: true }).fill(email);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("checkbox").check();
  await page.locator('form button[type="submit"]').click();
  await page.getByRole("heading", { name: `مرحبًا، ${name}` }).waitFor();
  const [users] = await db.query<any[]>("SELECT id FROM `user` WHERE email=?", [
    email,
  ]);
  assert.equal(users.length, 1);
  userId = users[0].id;
  await open("/academics");
  const teachers = page.getByRole("region", { name: "المعلمون" }),
    courses = page.getByRole("region", { name: "المقررات" });
  await teachers.getByLabel("الاسم").fill("الأستاذة ليلى");
  await teachers.getByLabel("البريد الإلكتروني").fill("layla@example.test");
  await teachers.getByRole("button", { name: "إضافة المعلم" }).click();
  await teachers.getByText("layla@example.test").waitFor();
  await courses.getByLabel("الاسم").fill("رياضيات ١");
  await courses.getByLabel("رمز المقرر").fill("MATH101");
  await courses.getByRole("checkbox", { name: /الأستاذة ليلى/ }).check();
  await courses
    .getByLabel("المعلم الافتراضي")
    .selectOption({ label: "الأستاذة ليلى" });
  await courses.getByRole("button", { name: "إضافة المقرر" }).click();
  await courses.getByText("MATH101").waitFor();
  await page.reload();
  await teachers.getByText("layla@example.test").waitFor();
  await courses.getByText("MATH101").waitFor();
  await page.getByLabel("ابحث عن معلم أو مقرر").fill("MATH101");
  await courses.getByText("MATH101").waitFor();
  assert.equal(await teachers.getByText("لا توجد نتائج").count(), 1);
  const [links] = await db.query<any[]>(
    "SELECT ct.teacher_id FROM basira_course_teachers ct JOIN basira_courses c ON c.id=ct.course_id WHERE c.user_id=?",
    [userId]
  );
  assert.equal(links.length, 1);
  console.log(
    "Academic directory browser PASS: signup, save teacher/course/default, reload, search, owned DB link."
  );
} finally {
  if (userId)
    await db.execute("DELETE FROM `user` WHERE id=? AND email=?", [
      userId,
      email,
    ]);
  await db.end();
  await browser.close();
}
