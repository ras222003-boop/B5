import { motion } from "framer-motion";

interface SectionHeadingProps {
  badge?: string;
  title: string;
  description?: string;
  centered?: boolean;
}

export default function SectionHeading({ badge, title, description, centered = true }: SectionHeadingProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
      className={`mb-12 md:mb-16 ${centered ? "text-center" : "text-start"}`}
    >
      {badge && (
        <span className="mb-4 inline-block rounded-full border border-amber-300/30 bg-amber-300/10 px-4 py-1.5 text-sm font-bold text-amber-200">
          {badge}
        </span>
      )}
      <h2 className="text-3xl font-bold leading-tight text-foreground md:text-4xl lg:text-5xl">
        {title}
      </h2>
      {description && (
        <p className={`mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground ${centered ? "mx-auto" : ""}`}>
          {description}
        </p>
      )}
    </motion.div>
  );
}
