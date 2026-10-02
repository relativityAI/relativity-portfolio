import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";

const FAQS = [
  {
    q: "Which markets and exchanges are covered?",
    a: "We currently cover Indian equities across NSE and BSE, including mid-caps and small-caps. More markets are on the roadmap.",
  },
  {
    q: "Where does the data come from?",
    a: "Financial statements, shareholding patterns, filings, earnings calls, corporate actions, insider and block deals, analyst estimates, price and volume data, news and sentiment, peer comparison, and credit ratings.",
  },
  {
    q: "Is this a broker? Does it place trades?",
    a: "No. Relativity AI is a research and screening tool. It does not place trades, hold cash, or interface with any broker.",
  },
  {
    q: "What does an agent mean here?",
    a: "An agent is a screening and analysis process you configure. You define a thesis in plain language, and the agent evaluates stocks against it.",
  },
  {
    q: "Is there a free tier?",
    a: "Yes. You can create agents and run analyses with no API keys required. Certain data sources may need you to supply your own API key.",
  },
];

export default function LandingFaq() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{ duration: dur.base, ease }}
    >
      <div className="flex flex-col gap-4">
        <h2 className="text-xl md:text-2xl font-bold text-[var(--ink-primary)] leading-tight">
          Frequently asked questions
        </h2>
        <Accordion type="single" collapsible>
          {FAQS.map((f) => (
            <AccordionItem key={f.q} value={f.q} className="border-b border-b-[var(--hairline)]">
              <AccordionTrigger className="py-4 text-[var(--ink-primary)] hover:text-[var(--accent-primary)] hover:no-underline [&[data-state=open]]:text-[var(--accent-primary)]">
                <span className="flex-1 text-sm md:text-base font-semibold text-left">
                  {f.q}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div>
                  <p className="text-sm md:text-base text-[var(--ink-secondary)] leading-relaxed">
                    {f.a}
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </motion.div>
  );
}