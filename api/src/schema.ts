/**
 * Agent schema descriptor — single source of truth for the builder agent.
 * When the agent data model changes, update SCHEMA_DESCRIPTOR here.
 * The builder and preview panel read this at runtime.
 */

export interface FieldDescriptor {
  key: string;
  type: "long_text" | "single_select" | "range" | "list" | "criteria_list";
  label: string;
  description?: string;
  options?: string[];
  min?: number;
  max?: number;
  default?: unknown;
}

export interface SubsectionDescriptor {
  key: string;
  label: string;
  type: "list" | "criteria_list";
  item_fields: string[];
}

export interface SectionDescriptor {
  key: string;
  label: string;
  description?: string;
  fields?: FieldDescriptor[];
  subsections?: SubsectionDescriptor[];
}

export interface SchemaDescriptor {
  sections: SectionDescriptor[];
  metrics_endpoint: string;
}

export const SCHEMA_DESCRIPTOR: SchemaDescriptor = {
  sections: [
    {
      key: "persona",
      label: "Agent Persona",
      description: "The investment philosophy and mindset that guides this agent's analysis",
      fields: [
        {
          key: "philosophy_and_mindset",
          type: "long_text",
          label: "Philosophy and Mindset",
          description: "A detailed description of the investment philosophy, beliefs, and decision-making framework",
        },
      ],
    },
    {
      key: "configuration",
      label: "Configuration",
      description: "Basic investment parameters",
      fields: [
        {
          key: "investment_horizon",
          type: "single_select",
          label: "Investment Horizon",
          options: ["Intraday", "Swing", "Positional", "Long-term (years)"],
          default: "",
        },
        {
          key: "risk_appetite",
          type: "range",
          label: "Risk Appetite",
          description: "1 = very conservative, 10 = very aggressive",
          min: 1,
          max: 10,
          default: 5,
        },
      ],
    },
    {
      key: "asset_evaluation",
      label: "Asset Evaluation",
      description: "How this agent evaluates individual companies",
      subsections: [
        {
          key: "qualitative",
          label: "Qualitative Parameters",
          type: "list",
          item_fields: ["parameter(string)", "content(long_text)", "weightage(number 1-10)"],
        },
        {
          key: "quantitative",
          label: "Quantitative Criteria",
          type: "criteria_list",
          item_fields: ["metric(metric_ref)", "metric_name(string)", "metric_type(string)", "operator(operator)", "value(number)", "value_upper(number)", "weightage(number 1-10)"],
        },
      ],
    },
    {
      key: "macro_evaluation",
      label: "Macro Evaluation",
      description: "How this agent evaluates market-level and macroeconomic factors",
      subsections: [
        {
          key: "qualitative",
          label: "Qualitative Parameters",
          type: "list",
          item_fields: ["parameter(string)", "content(long_text)", "weightage(number 1-10)"],
        },
        {
          key: "quantitative",
          label: "Quantitative Criteria",
          type: "criteria_list",
          item_fields: ["metric(metric_ref)", "metric_name(string)", "metric_type(string)", "operator(operator)", "value(number)", "value_upper(number)", "weightage(number 1-10)"],
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
