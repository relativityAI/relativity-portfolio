import axios from "axios";
import { API_BASE } from "@/db";

/** Agent loop budget (mirrors api/src/harness/types.ts Budget). */
export interface Budget {
  maxSteps: number;
  maxTokens: number;
  maxCostUsd: number;
  maxIterations: number;
}

export interface HarnessAgent {
  id: string;
  name: string;
  soulPrompt: string;
  skillIds: string[];
  allowedTools: string[];
  modelId: string | null;
  budget: Budget;
  /** Output template (format) applied last; null = contract only. */
  outputTemplateId: string | null;
}

export interface HarnessAgentInput {
  name: string;
  soulPrompt?: string;
  skillIds?: string[];
  allowedTools?: string[];
  modelId?: string | null;
  budget?: Partial<Budget>;
  outputTemplateId?: string | null;
}

/** The API returns snake_case (`skill_ids`, `output_template_id`, …). */
function toView(a: Record<string, any>): HarnessAgent {
  return {
    id: a.id,
    name: a.name,
    soulPrompt: a.soul_prompt ?? "",
    skillIds: a.skill_ids ?? [],
    allowedTools: a.allowed_tools ?? [],
    modelId: a.model_id ?? null,
    budget: a.budget ?? { maxSteps: 20, maxTokens: 200_000, maxCostUsd: 0.5, maxIterations: 6 },
    outputTemplateId: a.output_template_id ?? null,
  };
}

export interface OutputTemplateSummary {
  id: string;
  name: string;
  description: string;
  default?: boolean;
}

export const HarnessAgentService = {
  async list(): Promise<HarnessAgent[]> {
    const rows = (await axios.get(`${API_BASE}/harness/agents`)).data as Record<string, any>[];
    return rows.map(toView);
  },
  async listTemplates(): Promise<OutputTemplateSummary[]> {
    return (await axios.get(`${API_BASE}/harness/templates`)).data;
  },
  async create(input: HarnessAgentInput): Promise<HarnessAgent> {
    return toView((await axios.post(`${API_BASE}/harness/agents`, input)).data);
  },
  async update(id: string, input: Partial<HarnessAgentInput>): Promise<HarnessAgent> {
    return toView((await axios.put(`${API_BASE}/harness/agents/${encodeURIComponent(id)}`, input)).data);
  },
  async remove(id: string): Promise<void> {
    await axios.delete(`${API_BASE}/harness/agents/${encodeURIComponent(id)}`);
  },
  async runTest(id: string, symbol: string): Promise<unknown> {
    return (await axios.post(`${API_BASE}/harness/agents/${encodeURIComponent(id)}/run`, { symbol })).data;
  },
};
