/**
 * Photo Requirements Page
 * شروط الصورة لطلب وزارة الموارد البشرية
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, CheckCircle, AlertCircle, Download, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Requirement {
  id: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  icon: string;
  status: 'required' | 'recommended' | 'prohibited';
}

const requirements: Requirement[] = [
  {
    id: 'background',
    title: 'الخلفية البيضاء',
    titleEn: 'White Background',
    description: 'يجب أن تكون خلفية الصورة بيضاء نقية بدون أي نقوش أو ظلال',
    descriptionEn: 'The background must be pure white without any patterns or shadows',
    icon: '🎨',
    status: 'required',
  },
  {
    id: 'face-clear',
    title: 'وضوح الوجه',
    titleEn: 'Clear Face',
    description: 'يجب أن يكون الوجه واضحاً وظاهراً بشكل كامل بدون حجب أو ظلال',
    descriptionEn: 'The face must be clear and fully visible without obstruction or shadows',
    icon: '👤',
    status: 'required',
  },
  {
    id: 'size',
    title: 'حجم الوجه',
    titleEn: 'Face Size',
    description: 'يجب أن يشغل الوجه ما لا يقل عن 70% من مساحة الصورة',
    descriptionEn: 'The face must occupy at least 70% of the image area',
    icon: '📏',
    status: 'required',
  },
  {
    id: 'lighting',
    title: 'الإضاءة المتساوية',
    titleEn: 'Even Lighting',
    description: 'يجب أن تكون الإضاءة متساوية على الوجه بدون ظلال قاسية',
    descriptionEn: 'Lighting must be even across the face without harsh shadows',
    icon: '💡',
    status: 'required',
  },
  {
    id: 'expression',
    title: 'التعبير المحايد',
    titleEn: 'Neutral Expression',
    description: 'يجب أن يكون التعبير محايداً مع إغلاق الفم بشكل طبيعي',
    descriptionEn: 'Expression must be neutral with mouth closed naturally',
    icon: '😐',
    status: 'required',
  },
  {
    id: 'eyes-open',
    title: 'العيون مفتوحة',
    titleEn: 'Eyes Open',
    description: 'يجب أن تكون العيون مفتوحة وظاهرة بوضوح',
    descriptionEn: 'Eyes must be open and clearly visible',
    icon: '👁️',
    status: 'required',
  },
  {
    id: 'head-straight',
    title: 'الرأس مستقيم',
    titleEn: 'Head Straight',
    description: 'يجب أن يكون الرأس مستقيماً ومواجهاً للكاميرا مباشرة',
    descriptionEn: 'Head must be straight and facing the camera directly',
    icon: '📷',
    status: 'required',
  },
  {
    id: 'no-glasses',
    title: 'بدون نظارات شمسية',
    titleEn: 'No Sunglasses',
    description: 'يجب عدم ارتداء نظارات شمسية أو نظارات داكنة',
    descriptionEn: 'Sunglasses or dark glasses must not be worn',
    icon: '🚫',
    status: 'prohibited',
  },
  {
    id: 'no-hat',
    title: 'بدون غطاء الرأس',
    titleEn: 'No Head Cover',
    description: 'يجب عدم ارتداء أي غطاء للرأس ما عدا الحجاب الديني',
    descriptionEn: 'No head covering except religious hijab is allowed',
    icon: '🧢',
    status: 'prohibited',
  },
  {
    id: 'no-makeup',
    title: 'مكياج طبيعي',
    titleEn: 'Natural Makeup',
    description: 'يجب تجنب المكياج الثقيل والألوان الزاهية جداً',
    descriptionEn: 'Heavy makeup and very bright colors should be avoided',
    icon: '💄',
    status: 'recommended',
  },
  {
    id: 'professional-clothes',
    title: 'ملابس احترافية',
    titleEn: 'Professional Clothing',
    description: 'يفضل ارتداء ملابس احترافية وألوان محايدة',
    descriptionEn: 'Professional clothing and neutral colors are preferred',
    icon: '👔',
    status: 'recommended',
  },
  {
    id: 'recent-photo',
    title: 'صورة حديثة',
    titleEn: 'Recent Photo',
    description: 'يجب أن تكون الصورة حديثة وتعكس مظهرك الحالي',
    descriptionEn: 'Photo must be recent and reflect your current appearance',
    icon: '📅',
    status: 'required',
  },
];

const fileRequirements = [
  { label: 'صيغة الملف', labelEn: 'File Format', value: 'JPG, PNG, PDF' },
  { label: 'حجم الملف', labelEn: 'File Size', value: 'أقل من 5 ميجابايت / Less than 5 MB' },
  { label: 'دقة الصورة', labelEn: 'Image Resolution', value: '300 × 400 بكسل أو أعلى / 300 × 400 pixels or higher' },
  { label: 'نسبة العرض للارتفاع', labelEn: 'Aspect Ratio', value: '3:4 (عرض × ارتفاع / width × height)' },
];

export default function PhotoRequirements() {
  const [language, setLanguage] = useState<'ar' | 'en'>('ar');
  const [selectedTab, setSelectedTab] = useState('requirements');

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'required':
        return 'bg-red-50 border-red-200';
      case 'prohibited':
        return 'bg-orange-50 border-orange-200';
      case 'recommended':
        return 'bg-green-50 border-green-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'required':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
            <CheckCircle size={14} />
            {language === 'ar' ? 'مطلوب' : 'Required'}
          </span>
        );
      case 'prohibited':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-semibold">
            <AlertCircle size={14} />
            {language === 'ar' ? 'ممنوع' : 'Prohibited'}
          </span>
        );
      case 'recommended':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
            <CheckCircle size={14} />
            {language === 'ar' ? 'موصى به' : 'Recommended'}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 ${language === 'ar' ? 'rtl' : 'ltr'}`}>
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white py-8 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Camera size={32} />
              <h1 className={`text-3xl font-bold ${language === 'ar' ? 'text-right' : 'text-left'}`}>
                {language === 'ar' ? 'شروط الصورة' : 'Photo Requirements'}
              </h1>
            </div>
            <div className="flex gap-2">
              <Button
                variant={language === 'ar' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLanguage('ar')}
                className={language === 'ar' ? 'bg-white text-orange-600' : 'text-white border-white'}
              >
                العربية
              </Button>
              <Button
                variant={language === 'en' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLanguage('en')}
                className={language === 'en' ? 'bg-white text-orange-600' : 'text-white border-white'}
              >
                English
              </Button>
            </div>
          </div>
          <p className={`text-orange-100 ${language === 'ar' ? 'text-right' : 'text-left'}`}>
            {language === 'ar'
              ? 'متطلبات الصورة لطلب وزارة الموارد البشرية السعودية'
              : 'Photo requirements for Saudi Ministry of Human Resources application'}
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-12">
        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-8">
            <TabsTrigger value="requirements">
              {language === 'ar' ? 'الشروط' : 'Requirements'}
            </TabsTrigger>
            <TabsTrigger value="specifications">
              {language === 'ar' ? 'المواصفات' : 'Specifications'}
            </TabsTrigger>
            <TabsTrigger value="tips">
              {language === 'ar' ? 'نصائح' : 'Tips'}
            </TabsTrigger>
          </TabsList>

          {/* Requirements Tab */}
          <TabsContent value="requirements" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {requirements.map((req, index) => (
                <motion.div
                  key={req.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card className={`border-2 ${getStatusColor(req.status)} h-full`}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <CardTitle className={`text-lg ${language === 'ar' ? 'text-right' : 'text-left'}`}>
                            {language === 'ar' ? req.title : req.titleEn}
                          </CardTitle>
                          <CardDescription className={`mt-2 ${language === 'ar' ? 'text-right' : 'text-left'}`}>
                            {language === 'ar' ? req.description : req.descriptionEn}
                          </CardDescription>
                        </div>
                        <div className="text-3xl">{req.icon}</div>
                      </div>
                      <div className="mt-3">{getStatusBadge(req.status)}</div>
                    </CardHeader>
                  </Card>
                </motion.div>
              ))}
            </div>
          </TabsContent>

          {/* Specifications Tab */}
          <TabsContent value="specifications">
            <Card>
              <CardHeader>
                <CardTitle>{language === 'ar' ? 'مواصفات الملف' : 'File Specifications'}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {fileRequirements.map((req, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <div className={language === 'ar' ? 'text-right' : 'text-left'}>
                        <p className="font-semibold text-gray-900">
                          {language === 'ar' ? req.label : req.labelEn}
                        </p>
                        <p className="text-gray-600 text-sm mt-1">{req.value}</p>
                      </div>
                      <CheckCircle className="text-green-500" size={24} />
                    </motion.div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tips Tab */}
          <TabsContent value="tips">
            <div className="space-y-4">
              <Card className="bg-blue-50 border-blue-200">
                <CardHeader>
                  <CardTitle className="text-blue-900">
                    {language === 'ar' ? '💡 نصائح مهمة' : '💡 Important Tips'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className={`flex gap-3 ${language === 'ar' ? 'flex-row-reverse' : ''}`}>
                    <div className="text-2xl">✓</div>
                    <p className={language === 'ar' ? 'text-right' : 'text-left'}>
                      {language === 'ar'
                        ? 'استخدم كاميرا عالية الجودة أو هاتف ذكي حديث'
                        : 'Use a high-quality camera or modern smartphone'}
                    </p>
                  </div>
                  <div className={`flex gap-3 ${language === 'ar' ? 'flex-row-reverse' : ''}`}>
                    <div className="text-2xl">✓</div>
                    <p className={language === 'ar' ? 'text-right' : 'text-left'}>
                      {language === 'ar'
                        ? 'التقط الصورة في مكان مضاء جيداً بدون ظلال'
                        : 'Take the photo in a well-lit place without shadows'}
                    </p>
                  </div>
                  <div className={`flex gap-3 ${language === 'ar' ? 'flex-row-reverse' : ''}`}>
                    <div className="text-2xl">✓</div>
                    <p className={language === 'ar' ? 'text-right' : 'text-left'}>
                      {language === 'ar'
                        ? 'تأكد من أن الصورة تعكس مظهرك الحالي'
                        : 'Ensure the photo reflects your current appearance'}
                    </p>
                  </div>
                  <div className={`flex gap-3 ${language === 'ar' ? 'flex-row-reverse' : ''}`}>
                    <div className="text-2xl">✓</div>
                    <p className={language === 'ar' ? 'text-right' : 'text-left'}>
                      {language === 'ar'
                        ? 'تجنب استخدام فلاتر أو تطبيقات تعديل الصور'
                        : 'Avoid using filters or photo editing applications'}
                    </p>
                  </div>
                  <div className={`flex gap-3 ${language === 'ar' ? 'flex-row-reverse' : ''}`}>
                    <div className="text-2xl">✓</div>
                    <p className={language === 'ar' ? 'text-right' : 'text-left'}>
                      {language === 'ar'
                        ? 'اطلب من شخص آخر التقاط الصورة للحصول على أفضل النتائج'
                        : 'Ask someone else to take the photo for best results'}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-amber-50 border-amber-200">
                <CardHeader>
                  <CardTitle className="text-amber-900">
                    {language === 'ar' ? '⚠️ أخطاء شائعة' : '⚠️ Common Mistakes'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className={`flex gap-3 ${language === 'ar' ? 'flex-row-reverse' : ''}`}>
                    <div className="text-2xl">✗</div>
                    <p className={language === 'ar' ? 'text-right' : 'text-left'}>
                      {language === 'ar'
                        ? 'الصور ذات الخلفيات الملونة أو المنقوشة'
                        : 'Photos with colored or patterned backgrounds'}
                    </p>
                  </div>
                  <div className={`flex gap-3 ${language === 'ar' ? 'flex-row-reverse' : ''}`}>
                    <div className="text-2xl">✗</div>
                    <p className={language === 'ar' ? 'text-right' : 'text-left'}>
                      {language === 'ar'
                        ? 'الصور الملتقطة بزاوية مائلة أو من الجانب'
                        : 'Photos taken at an angle or from the side'}
                    </p>
                  </div>
                  <div className={`flex gap-3 ${language === 'ar' ? 'flex-row-reverse' : ''}`}>
                    <div className="text-2xl">✗</div>
                    <p className={language === 'ar' ? 'text-right' : 'text-left'}>
                      {language === 'ar'
                        ? 'الصور التي تحتوي على أشخاص آخرين'
                        : 'Photos containing other people'}
                    </p>
                  </div>
                  <div className={`flex gap-3 ${language === 'ar' ? 'flex-row-reverse' : ''}`}>
                    <div className="text-2xl">✗</div>
                    <p className={language === 'ar' ? 'text-right' : 'text-left'}>
                      {language === 'ar'
                        ? 'الصور القديمة أو التي لا تعكس مظهرك الحالي'
                        : 'Old photos or those that do not reflect your current appearance'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Action Buttons */}
        <div className="mt-12 flex flex-col sm:flex-row gap-4 justify-center">
          <Button size="lg" className="bg-orange-500 hover:bg-orange-600 text-white gap-2">
            <Download size={20} />
            {language === 'ar' ? 'تحميل الشروط (PDF)' : 'Download Requirements (PDF)'}
          </Button>
          <Button size="lg" variant="outline" className="gap-2">
            <ArrowRight size={20} />
            {language === 'ar' ? 'العودة للتقديم' : 'Back to Application'}
          </Button>
        </div>
      </div>
    </div>
  );
}
