/**
 * Agent schema descriptor — single source of truth for the builder agent.
 * When the agent data model changes, update SCHEMA_DESCRIPTOR here.
 * The builder and preview panel read this at runtime.
 */

export interface FieldDescriptor {
  key: string;
  type: "long_text" | "single_select" | "range" | "list" | "skill_list";
  label: string;
  description?: string;
  options?: string[];
  min?: number;
  max?: number;
  default?: unknown;
}

export interface SectionDescriptor {
  key: string;
  label: string;
  description?: string;
  fields?: FieldDescriptor[];
}

export interface SchemaDescriptor {
  sections: SectionDescriptor[];
  metrics_endpoint: string;
}

export const SCHEMA_DESCRIPTOR: SchemaDescriptor = {
  sections: [
    {
      key: "identity",
      label: "Identity",
      description: "Who this investor is",
      fields: [
        {
          key: "name",
          type: "long_text",
          label: "Name",
          description: "Short name for the agent",
        },
        {
          key: "description",
          type: "long_text",
          label: "Description",
          description: "One line describing who this agent is and how it invests",
        },
      ],
    },
    {
      key: "persona",
      label: "Agent Persona",
      description: "The investment philosophy that guides this agent's analysis",
      fields: [
        {
          key: "philosophy",
          type: "long_text",
          label: "Philosophy",
          description:
            "2-3 paragraphs in the investor's own voice: how they think, what they buy, and what they refuse to buy",
        },
      ],
    },
    {
      key: "skills",
      label: "Skills",
      description:
        "The skill documents this agent runs. Each skill owns its own method, data tools, and verdict anchors — the builder only chooses WHICH skills and how much each one matters.",
      fields: [
        {
          key: "skills",
          type: "skill_list",
          label: "Attached Skills",
          description: "3-6 entries of {skill_id, weight} — skill_id must come from the skill library; weight 1-10 by centrality",
        },
      ],
    },
  ],
  metrics_endpoint: "/api/metrics/fields",
};

/** Returns the schema descriptor. Separate function so it can be extended later. */
export function getSchemaDescriptor(): SchemaDescriptor {
  return SCHEMA_DESCRIPTOR;
}
