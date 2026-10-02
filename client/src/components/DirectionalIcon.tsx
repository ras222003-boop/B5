import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, type LucideProps } from "lucide-react";
import { useI18n } from "@/i18n";

/** Arrow that points toward "next/forward" in the active reading direction. */
export function ForwardArrow(props: LucideProps) {
  const { isRTL } = useI18n();
  return isRTL ? <ArrowLeft {...props} /> : <ArrowRight {...props} />;
}

/** Arrow that points toward "back/previous" in the active reading direction. */
export function BackArrow(props: LucideProps) {
  const { isRTL } = useI18n();
  return isRTL ? <ArrowRight {...props} /> : <ArrowLeft {...props} />;
}

export function ForwardChevron(props: LucideProps) {
  const { isRTL } = useI18n();
  return isRTL ? <ChevronLeft {...props} /> : <ChevronRight {...props} />;
}

export function BackChevron(props: LucideProps) {
  const { isRTL } = useI18n();
  return isRTL ? <ChevronRight {...props} /> : <ChevronLeft {...props} />;
}
