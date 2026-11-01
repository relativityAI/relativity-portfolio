import { useEffect, useState } from "react";
import { Box, Button, Flex, Input, Stack, Text, Textarea } from "@chakra-ui/react";
import { HarnessAgentService, type HarnessAgent } from "@/lib/harnessAgents";
import { SkillService, type SkillSummary } from "@/db";
import { SkillPicker } from "@/components/agents/SkillPicker";
import type { OutputTemplateSummary } from "@/lib/harnessAgents";

export function AgentsPage() {
  const [agents, setAgents] = useState<HarnessAgent[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [name, setName] = useState("");
  const [soulPrompt, setSoulPrompt] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [maxSteps, setMaxSteps] = useState(20);
  const [maxCostUsd, setMaxCostUsd] = useState(0.5);
  const [templates, setTemplates] = useState<OutputTemplateSummary[]>([]);
  const [outputTemplateId, setOutputTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    HarnessAgentService.list().then(setAgents).catch((e) => setError(e?.message ?? "failed to load agents"));
    HarnessAgentService.listTemplates().then(setTemplates).catch(() => setTemplates([]));
    SkillService.listSkills().then(setSkills).catch(() => {});
  }, []);

  const create = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    try {
      const agent = await HarnessAgentService.create({
        name,
        soulPrompt,
        skillIds,
        budget: { maxSteps, maxCostUsd },
        outputTemplateId: outputTemplateId || null,
      });
      setAgents((a) => [...a, agent]);
      setName("");
      setSoulPrompt("");
      setSkillIds([]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
    }
  };

  return (
    <Box p={6} maxW="900px" mx="auto" data-testid="agents-page">
      <Text as="h1" fontSize="2xl" fontWeight="bold" mb={4}>
        Agents
      </Text>
      {error && <Text color="red.fg" mb={2} data-testid="agents-error">{error}</Text>}
      <Stack gap={6}>
        <Box borderWidth="1px" borderRadius="md" p={4} data-testid="agent-form">
          <Text fontWeight="bold" mb={2}>
            Create a custom agent
          </Text>
          <Input
            placeholder="Agent name (e.g. EV Sector Analyst)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            mb={2}
            borderRadius="0"
            borderWidth="0.5px"
            data-testid="agent-name"
          />
          <Textarea
            placeholder="SOUL — the agent's system prompt / investment philosophy"
            value={soulPrompt}
            onChange={(e) => setSoulPrompt(e.target.value)}
            mb={2}
            borderRadius="0"
            borderWidth="0.5px"
            data-testid="agent-soul"
          />
          <Flex gap={4} mb={3}>
            <Box>
              <Text fontSize="sm">Max steps</Text>
              <Input
                type="number"
                value={maxSteps}
                onChange={(e) => setMaxSteps(Number(e.target.value))}
                borderRadius="0"
                borderWidth="0.5px"
                data-testid="agent-max-steps"
              />
            </Box>
            <Box>
              <Text fontSize="sm">Max cost (USD)</Text>
              <Input
                type="number"
                step="0.1"
                value={maxCostUsd}
                onChange={(e) => setMaxCostUsd(Number(e.target.value))}
                borderRadius="0"
                borderWidth="0.5px"
                data-testid="agent-max-cost"
              />
            </Box>
          </Flex>
          <Text fontSize="sm" mb={1}>
            Skills
          </Text>
          <SkillPicker skills={skills} selected={skillIds} onChange={setSkillIds} />
          <Text fontSize="sm" mb={1} mt={3}>
            Output format
          </Text>
          <select
            data-testid="agent-template-select"
            value={outputTemplateId}
            onChange={(e) => setOutputTemplateId(e.target.value)}
            className="w-full rounded border border-[var(--hairline)] bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="">Contract only</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Button mt={3} onClick={create} borderRadius="0" data-testid="create-agent">
            Create agent
          </Button>
        </Box>

        <Box>
          <Text fontWeight="bold" mb={2}>
            Your agents
          </Text>
          {agents.length === 0 ? (
            <Text color="fg.muted" data-testid="agents-empty">
              No agents yet.
            </Text>
          ) : (
            agents.map((a) => (
              <Box key={a.id} data-testid="agent-row" borderBottomWidth="1px" py={2}>
                <Text fontWeight="medium">{a.name}</Text>
                <Text fontSize="sm" color="fg.muted">
                  {a.skillIds.join(", ") || "no skills"} · {a.budget.maxSteps} steps · ${a.budget.maxCostUsd}
                  {a.outputTemplateId ? ` · format: ${a.outputTemplateId}` : ""}
                </Text>
              </Box>
            ))
          )}
        </Box>
      </Stack>
    </Box>
  );
}
