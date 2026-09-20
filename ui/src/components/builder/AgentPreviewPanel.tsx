import { useState } from "react";
import { Box, Flex, Text, Badge, Button } from "@chakra-ui/react";
import { motion, AnimatePresence } from "motion/react";
import { MdClose, MdCheck } from "react-icons/md";
import { dur, ease } from "@/lib/motion";
import { type } from "@/lib/tokens";
import type { ChangeItem } from "@/lib/draftDiff";

interface AgentPreviewPanelProps {
  agentDraft: Record<string, unknown>;
  isDirty: boolean;
  changes?: ChangeItem[];
  /** Accept the whole proposal into the shared agent state. */
  onApplyChanges?: () => void;
  /** Discard the whole proposal. */
  onClearChanges?: () => void;
  /** Revert a single proposed change back to the base agent. */
  onDiscardChange?: (change: ChangeItem) => void;
}

function Expandable({ text, limit = 140 }: { text: string; limit?: number }) {
  const [open, setOpen] = useState(false);
  if (text.length <= limit) return <>{text}</>;
  return (
    <>
      {open ? text : `${text.slice(0, limit).trimEnd()}…`}
      <Button
        variant="ghost"
        size="xs"
        mt={0.5}
        display="inline"
        minH="20px"
        h="20px"
        color="var(--accent-primary)"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? "Show less" : "Show more"}
      </Button>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box mb={3}>
      <Text fontSize={type.micro} fontWeight={600} color="var(--ink-tertiary)" letterSpacing="0.06em" textTransform="uppercase" mb={1}>
        {label}
      </Text>
      {children}
    </Box>
  );
}

function QualParamItem({ param }: { param: { parameter: string; content?: string; weightage?: number } }) {
  return (
    <Flex direction="column" gap={0.5} py={1.5} borderBottom="1px solid var(--hairline)">
      <Flex justify="space-between" align="center">
        <Text fontSize={type.meta} fontWeight={500} color="var(--ink-primary)">{param.parameter}</Text>
        {param.weightage != null && (
          <Badge fontSize={type.micro} colorPalette="blue" variant="surface" fontWeight={500}>
            {param.weightage}/10
          </Badge>
        )}
      </Flex>
      {param.content && (
        <Text fontSize={type.micro} color="var(--ink-secondary)" lineHeight="short">
          <Expandable text={param.content} />
        </Text>
      )}
    </Flex>
  );
}

function QuantRuleItem({ rule }: { rule: { metric_name?: string; metric?: string; operator?: string; value?: number; weightage?: number } }) {
  const opLabel: Record<string, string> = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=", between: "between" };
  return (
    <Flex justify="space-between" align="center" py={1} borderBottom="1px solid var(--hairline)">
      <Text fontSize={type.meta} color="var(--ink-primary)">
        {rule.metric_name || rule.metric} {opLabel[rule.operator || ""] || rule.operator} {rule.value}
      </Text>
      {rule.weightage != null && (
        <Badge fontSize={type.micro} colorPalette="blue" variant="surface" fontWeight={500}>
          {rule.weightage}/10
        </Badge>
      )}
    </Flex>
  );
}

function ChangeList({ changes, onDiscard }: { changes: ChangeItem[]; onDiscard?: (c: ChangeItem) => void }) {
  return (
    <Flex direction="column">
      {changes.map((c, i) => (
        <Flex key={`${c.label}-${i}`} gap={2} py={0.5} align="flex-start">
          <Box flexShrink={0} mt="5px" w="4px" h="4px" borderRadius="50%" bg="var(--signal-caution)" />
          <Text fontSize={type.micro} lineHeight="1.4" color="var(--ink-secondary)" flex={1} minW={0}>
            <Text as="span" fontWeight={500} color="var(--ink-primary)">{c.label}</Text>
            {" — "}
            {c.detail}
          </Text>
          {onDiscard && c.path && (
            <Button
              variant="ghost"
              size="xs"
              minH="24px"
              h="24px"
              flexShrink={0}
              color="var(--ink-tertiary)"
              _hover={{ color: "var(--signal-negative)" }}
              onClick={() => onDiscard(c)}
              aria-label={`Discard ${c.label}`}
            >
              <MdClose size={13} /> Revert
            </Button>
          )}
        </Flex>
      ))}
    </Flex>
  );
}

export default function AgentPreviewPanel({
  agentDraft,
  isDirty,
  changes = [],
  onApplyChanges,
  onClearChanges,
  onDiscardChange,
}: AgentPreviewPanelProps) {
  const config = (agentDraft.configuration || {}) as any;
  const assetEval = (agentDraft.asset_evaluation || {}) as any;
  const macroEval = (agentDraft.macro_evaluation || {}) as any;
  const name = (agentDraft.name as string) || "Untitled Agent";
  const philosophy = (agentDraft.persona as any)?.philosophy_and_mindset || (agentDraft as any).philosophy || "";
  const horizon = config.investment_horizon || "";
  const risk = config.risk_appetite;
  const assetQual = assetEval.qualitative || ([] as any[]);
  const assetQuant = assetEval.quantitative || ([] as any[]);
  const macroQual = macroEval.qualitative || ([] as any[]);
  const macroQuant = macroEval.quantitative || ([] as any[]);
  const hasContent = philosophy || horizon || risk || assetQual.length || assetQuant.length;

  return (
    <Flex direction="column" h="100%" minH={0}>
      <Flex justify="space-between" align="center" mb={2} px={0.5}>
        <Text fontSize={type.micro} fontWeight={600} color="var(--ink-tertiary)" letterSpacing="0.06em" textTransform="uppercase">
          Agent Preview
        </Text>
        {isDirty && (
          <Badge fontSize="9px" colorPalette="orange" variant="surface" fontWeight={500}>
            Unsaved
          </Badge>
        )}
      </Flex>

      <Box flex={1} overflowY="auto" px={1}>
        <AnimatePresence initial={false}>
          {changes.length > 0 && (
            <motion.div
              key="changes"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: dur.base, ease }}
              style={{ overflow: "hidden" }}
            >
              <Box mb={3} p={2.5} borderRadius="4px" border="1px solid var(--hairline)" bg="var(--surface-recessed)">
                <Flex justify="space-between" align="center" mb={1}>
                  <Text fontSize={type.micro} fontWeight={600} color="var(--signal-caution)" letterSpacing="0.06em" textTransform="uppercase">
                    Proposed changes
                  </Text>
                  {onClearChanges && (
                    <Button
                      variant="ghost"
                      size="xs"
                      minH="24px"
                      h="24px"
                      color="var(--ink-tertiary)"
                      onClick={onClearChanges}
                    >
                      Discard all
                    </Button>
                  )}
                </Flex>
                <ChangeList changes={changes} onDiscard={onDiscardChange} />
                {onApplyChanges && (
                  <Button
                    size="xs"
                    mt={2}
                    variant="surface"
                    colorPalette="blue"
                    w="full"
                    minH="36px"
                    onClick={onApplyChanges}
                  >
                    <MdCheck size={13} /> Apply changes to agent
                  </Button>
                )}
              </Box>
            </motion.div>
          )}
        </AnimatePresence>

        {!hasContent ? (
          <Flex direction="column" align="center" justify="center" h="100%" gap={2}>
            <Text fontSize={type.meta} color="var(--ink-tertiary)" textAlign="center">
              Agent preview will appear here as you build it.
            </Text>
          </Flex>
        ) : (
          <>
            <Text fontSize="15px" fontWeight={600} color="var(--ink-primary)" mb={2}>
              {name}
            </Text>

            {philosophy && (
              <Section label="Philosophy">
                <Text fontSize={type.meta} color="var(--ink-secondary)" lineHeight="1.5">
                  <Expandable text={philosophy} limit={200} />
                </Text>
              </Section>
            )}

            {(horizon || risk) && (
              <Section label="Configuration">
                <Flex gap={3}>
                  {horizon && <Text fontSize={type.meta} color="var(--ink-primary)">{horizon}</Text>}
                  {risk && <Text fontSize={type.meta} color="var(--ink-primary)">Risk: {risk}/10</Text>}
                </Flex>
              </Section>
            )}

            {assetQual.length > 0 && (
              <Section label={`Asset Qualitative (${assetQual.length})`}>
                {assetQual.map((p: any, i: number) => (
                  <QualParamItem key={p.parameter || i} param={p} />
                ))}
              </Section>
            )}

            {assetQuant.length > 0 && (
              <Section label={`Asset Quantitative (${assetQuant.length})`}>
                {assetQuant.map((r: any, i: number) => (
                  <QuantRuleItem key={`${r.metric_name || r.metric}-${r.operator}-${r.value}-${i}`} rule={r} />
                ))}
              </Section>
            )}

            {macroQual.length > 0 && (
              <Section label={`Macro Qualitative (${macroQual.length})`}>
                {macroQual.map((p: any, i: number) => (
                  <QualParamItem key={p.parameter || i} param={p} />
                ))}
              </Section>
            )}

            {macroQuant.length > 0 && (
              <Section label={`Macro Quantitative (${macroQuant.length})`}>
                {macroQuant.map((r: any, i: number) => (
                  <QuantRuleItem key={`${r.metric_name || r.metric}-${r.operator}-${r.value}-${i}`} rule={r} />
                ))}
              </Section>
            )}
          </>
        )}
      </Box>
    </Flex>
  );
}