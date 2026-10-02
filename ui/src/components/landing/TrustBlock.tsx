import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";

const ITEMS = [
  {
    title: "Not investment advice.",
    body: "Relativity AI provides research tools and scoring. It does not tell you what to buy or sell.",
  },
  {
    title: "No trade calls.",
    body: "You decide what to do with the score. The platform does not place orders or recommend actions.",
  },
  {
    title: "No hidden ranking.",
    body: "Every criterion in the FIT score is visible. There is no black-box weighting or opaque ranking.",
  },
];

export default function TrustBlock() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{ duration: dur.base, ease }}
    >
      <div className="flex flex-col gap-6">
        <h2 className="text-xl md:text-2xl font-bold text-[var(--ink-primary)] leading-tight">
          What this is not
        </h2>
        {/* Divided rows instead of card grid — separation via 1px lines, not boxes */}
        <div className="flex flex-col">
          {ITEMS.map((item) => (
            <div
              key={item.title}
              className="flex flex-col md:flex-row gap-1 md:gap-8 items-stretch md:items-baseline py-4 md:py-5 border-t border-t-[var(--hairline)]"
            >
              <p className="text-base md:text-lg font-semibold text-[var(--ink-primary)] leading-snug md:basis-[240px] md:grow-0 md:shrink-0">
                {item.title}
              </p>
              <p className="text-sm md:text-base text-[var(--ink-secondary)] leading-relaxed max-w-[60ch]">
                {item.body}
              </p>
            </div>
          ))}
          <div className="border-t border-t-[var(--hairline)]" />
        </div>
      </div>
    </motion.div>
  );
}
