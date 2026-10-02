import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";
import screenshot from "@/assets/hero-screenshot.png";

export default function ProofSection() {
  return (
    <div className="bg-[var(--surface-inverse)] rounded-2xl overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-15%" }}
        transition={{ duration: dur.slow, ease }}
      >
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-8 md:gap-12 px-6 md:px-12 py-10 md:py-14">
          <div className="flex flex-col gap-4 flex-1">
            <p className="font-[family-name:var(--font-mono)] text-xs font-semibold tracking-[0.12em] text-[var(--ink-inverse-tertiary)]">
              THE RECEIPTS
            </p>
            <h2 className="text-2xl md:text-3xl font-bold text-[var(--ink-inverse-primary)] leading-tight">
              Every score shows its work.
            </h2>
            <div className="flex flex-col gap-3">
              <p className="text-sm md:text-base text-[var(--ink-inverse-secondary)] leading-relaxed">
                Your agent reads financial statements, shareholding patterns, filings, and earnings calls — then scores every stock on how well it fits your thesis.
              </p>
              <p className="text-sm md:text-base text-[var(--ink-inverse-secondary)] leading-relaxed">
                When the data is thin, it says so: scores carry a coverage figure and an uncertainty band instead of false confidence. Unknown is never quietly counted as zero.
              </p>
            </div>
          </div>

          <div className="flex flex-1 justify-center items-center">
            <motion.img
              src={screenshot}
              alt="Relativity analysis result showing a FIT score and per-criterion evaluation"
              className="max-w-full md:max-w-[420px] w-full h-auto rounded-xl border border-[var(--grid-line)] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] block"
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
}
