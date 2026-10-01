import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, BookOpen, HeartHandshake, LockKeyhole, Mail, RefreshCcw, ShieldCheck, Sparkles } from "lucide-react";
import Layout from "@/components/Layout";
import BrandLogo from "@/components/BrandLogo";

const email = "aurum.nexus.r1@gmail.com";

function PageShell({ title, eyebrow, intro, children }: { title: string; eyebrow: string; intro: string; children: React.ReactNode }) {
  useEffect(() => { document.title = `${title} | بصيرة · Aurum Nexus`; }, [title]);
  return (
    <Layout>
      <section className="relative overflow-hidden border-b border-amber-200/15 bg-[#0b0a08] py-16 sm:py-24">
        <div className="absolute -left-24 top-0 h-80 w-80 rounded-full border border-amber-200/15" aria-hidden="true" />
        <div className="container relative z-10 max-w-5xl">
          <div className="mb-7 flex items-center gap-3 text-xs font-bold tracking-[0.18em] text-amber-300"><BrandLogo alt="" className="h-9 w-9 rounded-full" /> AURUM NEXUS <span className="h-px w-16 bg-amber-300/40" /></div>
          <p className="mb-3 text-sm font-semibold text-amber-200">{eyebrow}</p>
          <h1 className="text-4xl font-black leading-tight text-white sm:text-6xl">{title}</h1>
          <p className="mt-5 max-w-2xl text-lg leading-9 text-stone-300">{intro}</p>
        </div>
      </section>
      <div className="container max-w-5xl py-12 sm:py-20">{children}</div>
    </Layout>
  );
}

function Detail({ icon: Icon, title, children }: { icon: typeof ShieldCheck; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-amber-200/15 bg-card/80 p-6 sm:p-8">
      <div className="mb-4 flex items-center gap-3"><span className="rounded-xl bg-amber-300/10 p-2.5 text-amber-300"><Icon aria-hidden="true" className="h-5 w-5" /></span><h2 className="text-xl font-bold text-white">{title}</h2></div>
      <div className="space-y-3 text-base leading-8 text-stone-300">{children}</div>
    </section>
  );
}

export function About() {
  return (
    <PageShell title="من نحن" eyebrow="التقنية في خدمة الاستقلال" intro="بصيرة منصة تعليمية من Aurum Nexus تساعد الطلاب ذوي الإعاقة البصرية على التفاعل مع الاختبارات والأدوات المساندة بوضوح واستقلالية.">
      <div className="grid gap-5 md:grid-cols-2">
        <Detail icon={Sparkles} title="لماذا بصيرة؟"><p>نؤمن بأن الوصول إلى الأسئلة وفهمها والإجابة عنها يجب ألا يعتمد على وجود مرافق. لهذا تجمع بصيرة قراءة الصور، القراءة الصوتية، أدوات الإجابة، وإرشادًا ذكيًا في تجربة عربية واحدة.</p></Detail>
        <Detail icon={HeartHandshake} title="ما الذي نقدمه؟"><p>مسح أوراق الاختبارات، الاستماع للأسئلة، الإجابة بالصوت أو الكتابة، المساعد الرقمي، تصدير الإجابات، وإرشاد للدعم الفني عند التعثر.</p></Detail>
        <Detail icon={ShieldCheck} title="نهجنا"><p>نصمم بلغة عربية واضحة، ومسارات قابلة للاستخدام بلوحة المفاتيح، وتباين مرتفع. تختلف إتاحة التعرف الصوتي والكاميرا باختلاف المتصفح والأذونات.</p></Detail>
        <Detail icon={BookOpen} title="تواصل معنا"><p>للاستفسارات أو مشاكل الاستخدام، انتقل إلى صفحة الدعم أو راسلنا على <a className="text-amber-300 underline" href={`mailto:${email}`}>{email}</a>.</p></Detail>
      </div>
      <Link href="/features" className="mt-8 inline-flex items-center gap-2 font-bold text-amber-200 hover:text-amber-100">استعرض خدمات بصيرة <ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link>
    </PageShell>
  );
}

export function Terms() {
  return (
    <PageShell title="الشروط والأحكام" eyebrow="استخدام واضح ومسؤول" intro="توضح هذه الشروط القواعد العامة لاستخدام بصيرة. آخر تحديث: 1 أكتوبر 2026.">
      <div className="space-y-5">
        <Detail icon={BookOpen} title="استخدام الخدمة"><p>بصيرة تقدم أدوات مساعدة للتعلم والاختبارات. استخدمها وفق قواعد مؤسستك التعليمية والقوانين المطبقة، ولا ترفع صورًا أو معلومات لا يحق لك معالجتها.</p></Detail>
        <Detail icon={ShieldCheck} title="دقة المخرجات"><p>تُولِّد أدوات قراءة الصور والتصحيح والمساعدة نتائج آلية قابلة للخطأ. راجع النصوص والإجابات والنتائج قبل اعتمادها؛ ولا تُعد المخرجات بديلًا عن تقييم المعلم أو القرار المؤسسي.</p></Detail>
        <Detail icon={LockKeyhole} title="حسابك وبياناتك"><p>احفظ وسيلة دخولك آمنة، وأبلغنا إن اشتبهت في استخدام غير مصرح به. لا تستخدم الخدمة للإساءة أو إرسال ملفات ضارة أو إغراق واجهة الدعم.</p></Detail>
        <Detail icon={Mail} title="تحديثات واستفسارات"><p>قد تُحدث الشروط عند تغيّر خصائص المنصة. تُنشر النسخة المحدثة هنا، ويمكن التواصل معنا على <a href={`mailto:${email}`} className="text-amber-300 underline">{email}</a>.</p></Detail>
      </div>
    </PageShell>
  );
}

export function Privacy() {
  return (
    <PageShell title="سياسة الخصوصية" eyebrow="بياناتك تحت اهتمامنا" intro="هذه الصفحة تشرح البيانات التي تحتاجها بصيرة وكيف تستخدمها عند تفعيل الحساب أو استخدام الأدوات. آخر تحديث: 1 أكتوبر 2026.">
      <div className="space-y-5">
        <Detail icon={LockKeyhole} title="البيانات التي نجمعها"><p>عند إنشاء حساب نحفظ الاسم والبريد وعنوان جلسة الحساب والمعرّف الوارد من مزود الدخول، إن استخدمته. وعند فتح تذكرة نحفظ بيانات التواصل ووصف المشكلة ومقتطف المحادثة الذي تختار إرساله.</p></Detail>
        <Detail icon={Sparkles} title="الذكاء الاصطناعي والملفات"><p>يُرسل نص السؤال أو صورة ورقة الاختبار أو رسالة الدعم إلى خدمة معالجة الذكاء الاصطناعي لإنتاج الرد المطلوب. تجنب إدراج معلومات حساسة غير ضرورية. قد تتأثر إتاحة الصوت والكاميرا بأذونات المتصفح.</p></Detail>
        <Detail icon={ShieldCheck} title="التخزين والوصول"><p>تُحفظ الحسابات والتذاكر في قاعدة بيانات المشروع. تستخدم الجلسة ملف تعريف ارتباط آمن. لا ننشر رسائل الدعم للعموم؛ وقد تصل التذاكر إلى بريد الدعم عند تهيئة الإرسال.</p></Detail>
        <Detail icon={RefreshCcw} title="طلبات البيانات"><p>يمكنك الاستفسار عن بياناتك أو طلب تصحيحها أو حذفها بمراسلة <a href={`mailto:${email}`} className="text-amber-300 underline">{email}</a>، مع مراعاة أي التزامات تشغيلية أو نظامية سارية. تُحدّث هذه الصفحة عند تغير ممارسات الخدمة.</p></Detail>
      </div>
    </PageShell>
  );
}

export function RefundPolicy() {
  return (
    <PageShell title="سياسة الإلغاء والاسترداد" eyebrow="شفافية الخدمات" intro="تشرح هذه السياسة الوضع الحالي لخدمات بصيرة وما يحدث إذا استُحدثت خدمات مدفوعة مستقبلًا. آخر تحديث: 1 أكتوبر 2026.">
      <div className="space-y-5">
        <Detail icon={RefreshCcw} title="الوضع الحالي"><p>لا تعرض بصيرة حاليًا اشتراكات أو صفحة دفع داخل المنصة. لذلك لا توجد عملية شراء داخل الموقع يمكن إلغاؤها أو استرداد قيمتها حاليًا.</p></Detail>
        <Detail icon={ShieldCheck} title="إن أضيفت خدمة مدفوعة"><p>إذا أُضيفت خدمات أو اشتراكات مدفوعة لاحقًا، ستُنشر شروط سعرها وإلغائها واستردادها قبل إتمام أي عملية شراء؛ ولا تُطبَّق سياسة لاحقة بأثر رجعي على عمليات سابقة.</p></Detail>
        <Detail icon={Mail} title="طلب المساعدة"><p>إن كان لديك سؤال عن اشتراك أو عملية خارج هذه المنصة، راسلنا على <a href={`mailto:${email}`} className="text-amber-300 underline">{email}</a> مع وصف الحالة دون مشاركة بيانات دفع حساسة.</p></Detail>
      </div>
    </PageShell>
  );
}

export function Contact() {
  return (
    <PageShell title="تواصل معنا" eyebrow="نحن هنا لنساعدك" intro="ابدأ بمساعد الدعم الفني لمعالجة مشكلتك خطوة بخطوة. إذا لم تُحلّ، يمكنك إنشاء تذكرة متابعة واضحة من نفس الصفحة.">
      <div className="grid gap-5 md:grid-cols-2">
        <Detail icon={HeartHandshake} title="الدعم الذكي"><p>اشرح المشكلة بالكلمات التي تناسبك، وسيرشدك مساعد بصيرة إلى خطوات عملية. يمكنك فتح تذكرة إذا لم تنجح الخطوات.</p><Link href="/support" className="inline-flex items-center gap-2 font-bold text-amber-300 hover:text-amber-100">افتح الدعم الفني <ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link></Detail>
        <Detail icon={Mail} title="البريد المخصص"><p>للتواصل المباشر اكتب إلى البريد الرسمي للدعم:</p><a href={`mailto:${email}`} className="break-all text-lg font-bold text-amber-300 underline" dir="ltr">{email}</a><p>لا تشارك كلمة مرور أو معلومات دفع عبر البريد أو المحادثة.</p></Detail>
      </div>
    </PageShell>
  );
}
