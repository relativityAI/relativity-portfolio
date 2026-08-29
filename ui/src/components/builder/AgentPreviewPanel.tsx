import { Box, Flex, Text, Badge } from "@chakra-ui/react";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";

interface AgentPreviewPanelProps {
  agentDraft: Record<string, unknown>;
  isDirty: boolean;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <motion.div layout transition={{ duration: dur.base, ease }}>
      <Box mb={3}>
        <Text fontSize="10px" fontWeight={600} color="var(--ink-tertiary)" letterSpacing="0.06em" textTransform="uppercase" mb={1}>
          {label}
        </Text>
        {children}
      </Box>
    </motion.div>
  );
}

const itemAnim = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: dur.base, ease } },
  exit: { opacity: 0, y: -4, transition: { duration: dur.fast, ease } },
};

function QualParamItem({ param }: { param: { parameter: string; content?: string; weightage?: number } }) {
  return (
    <motion.div layout {...itemAnim} transition={{ duration: dur.base, ease }}>
      <Flex direction="column" gap={0.5} py={1.5} borderBottom="1px solid var(--hairline)">
        <Flex justify="space-between" align="center">
          <Text fontSize="12px" fontWeight={500} color="var(--ink-primary)">{param.parameter}</Text>
          {param.weightage != null && (
            <Badge fontSize="10px" colorPalette="blue" variant="surface" fontWeight={500}>
              {param.weightage}/10
            </Badge>
          )}
        </Flex>
        {param.content && (
          <Text fontSize="11px" color="var(--ink-secondary)" lineHeight="short">
            {param.content.length > 120 ? param.content.slice(0, 120) + "..." : param.content}
          </Text>
        )}
      </Flex>
    </motion.div>
  );
}

function QuantRuleItem({ rule }: { rule: { metric_name?: string; metric?: string; operator?: string; value?: number; weightage?: number } }) {
  const opLabel: Record<string, string> = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=", between: "between" };
  return (
    <motion.div layout {...itemAnim} transition={{ duration: dur.base, ease }}>
      <Flex justify="space-between" align="center" py={1} borderBottom="1px solid var(--hairline)">
        <Text fontSize="12px" color="var(--ink-primary)">
          {rule.metric_name || rule.metric} {opLabel[rule.operator || ""] || rule.operator} {rule.value}
        </Text>
        {rule.weightage != null && (
          <Badge fontSize="10px" colorPalette="blue" variant="surface" fontWeight={500}>
            {rule.weightage}/10
          </Badge>
        )}
      </Flex>
    </motion.div>
  );
}

export default function AgentPreviewPanel({ agentDraft, isDirty }: AgentPreviewPanelProps) {
  const name = agentDraft.name || "Untitled Agent";
  const philosophy = agentDraft.persona?.philosophy_and_mindset || "";
  const horizon = agentDraft.configuration?.investment_horizon || "";
  const risk = agentDraft.configuration?.risk_appetite;
  const assetQual = agentDraft.asset_evaluation?.qualitative || [];
  const assetQuant = agentDraft.asset_evaluation?.quantitative || [];
  const macroQual = agentDraft.macro_evaluation?.qualitative || [];
  const macroQuant = agentDraft.macro_evaluation?.quantitative || [];
  const hasContent = philosophy || horizon || risk || assetQual.length || assetQuant.length;

  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: dur.base, ease }}
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <Flex justify="space-between" align="center" mb={3} px={1}>
        <Text fontSize="11px" fontWeight={600} color="var(--ink-tertiary)" letterSpacing="0.06em" textTransform="uppercase">
          Agent Preview
        </Text>
        {isDirty && (
          <AnimatePresence initial={false}>
            <motion.span key="unsaved" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: dur.fast, ease }}>
              <Badge fontSize="9px" colorPalette="orange" variant="surface" fontWeight={500}>
                Unsaved
              </Badge>
            </motion.span>
          </AnimatePresence>
        )}
      </Flex>

      <Box flex={1} overflowY="auto" px={1}>
        <AnimatePresence mode="wait" initial={false}>
        {!hasContent ? (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: dur.fast, ease }} style={{ height: "100%" }}>
          <Flex direction="column" align="center" justify="center" h="100%" gap={2}>
            <Text fontSize="12px" color="var(--ink-tertiary)" textAlign="center">
              Agent preview will appear here as you build it.
            </Text>
          </Flex>
          </motion.div>
        ) : (
          <motion.div key="content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: dur.base, ease }}>
            <Text fontSize="15px" fontWeight={600} color="var(--ink-primary)" mb={2}>
              {name}
            </Text>

            {philosophy && (
              <Section label="Philosophy">
                <Text fontSize="12px" color="var(--ink-secondary)" lineHeight="1.5">
                  {philosophy.length > 200 ? philosophy.slice(0, 200) + "..." : philosophy}
                </Text>
              </Section>
            )}

            {(horizon || risk) && (
              <Section label="Configuration">
                <Flex gap={3}>
                  {horizon && <Text fontSize="12px" color="var(--ink-primary)">{horizon}</Text>}
                  {risk && <Text fontSize="12px" color="var(--ink-primary)">Risk: {risk}/10</Text>}
                </Flex>
              </Section>
            )}

            {assetQual.length > 0 && (
              <Section label={`Asset Qualitative (${assetQual.length})`}>
                <AnimatePresence initial={false}>
                  {assetQual.map((p: { parameter: string; content?: string; weightage?: number }, i: number) => (
                    <QualParamItem key={p.parameter || i} param={p} />
                  ))}
                </AnimatePresence>
              </Section>
            )}

            {assetQuant.length > 0 && (
              <Section label={`Asset Quantitative (${assetQuant.length})`}>
                <AnimatePresence initial={false}>
                  {assetQuant.map((r: { metric_name?: string; metric?: string; operator?: string; value?: number; weightage?: number }, i: number) => (
                    <QuantRuleItem key={`${r.metric_name || r.metric}-${r.operator}-${r.value}-${i}`} rule={r} />
                  ))}
                </AnimatePresence>
              </Section>
            )}

            {macroQual.length > 0 && (
              <Section label={`Macro Qualitative (${macroQual.length})`}>
                <AnimatePresence initial={false}>
                  {macroQual.map((p: { parameter: string; content?: string; weightage?: number }, i: number) => (
                    <QualParamItem key={p.parameter || i} param={p} />
                  ))}
                </AnimatePresence>
              </Section>
            )}

            {macroQuant.length > 0 && (
              <Section label={`Macro Quantitative (${macroQuant.length})`}>
                <AnimatePresence initial={false}>
                  {macroQuant.map((r: { metric_name?: string; metric?: string; operator?: string; value?: number; weightage?: number }, i: number) => (
                    <QuantRuleItem key={`${r.metric_name || r.metric}-${r.operator}-${r.value}-${i}`} rule={r} />
                  ))}
                </AnimatePresence>
              </Section>
            )}
          </motion.div>
        )}
        </AnimatePresence>
      </Box>
    </motion.div>
  );
}
