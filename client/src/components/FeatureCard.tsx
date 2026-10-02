import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  index?: number;
}

export default function FeatureCard({ icon: Icon, title, description, index = 0 }: FeatureCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-30px" }}
      transition={{ duration: 0.5, delay: index * 0.08, ease: [0.23, 1, 0.32, 1] }}
      className="group rounded-2xl border border-amber-200/15 bg-card/95 p-6 text-start transition-all duration-300 hover:-translate-y-1 hover:border-amber-300/60 hover:shadow-[0_18px_45px_rgba(0,0,0,0.28)] md:p-8"
    >
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl border border-amber-300/20 bg-amber-300/10 transition-colors duration-300 group-hover:bg-amber-300/20">
        <Icon className="h-7 w-7 text-amber-300" />
      </div>
      <h3 className="mb-2 text-lg font-bold text-foreground">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
    </motion.div>
  );
}
