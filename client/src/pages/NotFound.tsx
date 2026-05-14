import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";
import Layout from "@/components/Layout";

export default function NotFound() {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="text-8xl font-bold text-amber-200 mb-4">404</div>
        <h1 className="text-2xl font-bold mb-2">الصفحة غير موجودة</h1>
        <p className="text-muted-foreground mb-8">عذراً، الصفحة التي تبحث عنها غير موجودة.</p>
        <Link href="/">
          <Button className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl">
            <Home className="w-4 h-4 ml-2" />
            العودة للرئيسية
          </Button>
        </Link>
      </div>
    </Layout>
  );
}
