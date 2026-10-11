# Universal Skill Run Output Contract

## Objective

All skill executions must produce a consistent, readable, evidence-grounded report while allowing each skill to determine its own analytical content.

## Required structure

1. **Run metadata**
   - Skill name and version, if available
   - Subject and scope
   - Relevant time period and execution timestamp
   - Data freshness, where applicable

2. **Executive summary**
   - Main conclusion or outcome
   - Overall status or assessment, where meaningful
   - Most important findings
   - Confidence level, only when justified

3. **Key findings**
   - Finding or claim
   - Supporting evidence
   - Interpretation and significance
   - Severity, priority, or impact, when relevant

4. **Detailed analysis**
   - Dynamically selected sections appropriate to the skill
   - Relevant metrics, calculations, tables, charts, comparisons, and diagnostics
   - Methodology where needed to interpret results

5. **Recommendations or implications**
   - Actionable next steps, if applicable
   - Rationale and expected impact
   - Priority and dependencies, when meaningful
   - If no action is warranted, explain why

6. **Limitations and uncertainty**
   - Missing or stale data
   - Assumptions and unresolved questions
   - Methodological limitations
   - Material uncertainty that could change the conclusion

7. **Evidence and provenance**
   - Sources supporting material claims
   - Relevant dates, periods, and data references
   - Distinction between observed facts, derived results, assumptions, and hypotheses

## Adaptation rules

- The skill's purpose determines the detailed analysis sections.
- The common structure is a contract, not a rigid document outline.
- Omit irrelevant sections; never fill them with generic text.
- Preserve useful skill-specific formatting and domain terminology.
- Use tables and charts when they improve comprehension, not decoratively.
- Present the conclusion before extensive supporting detail.
- Separate facts from interpretations and recommendations.
- Never fabricate data, sources, citations, tool results, or confidence estimates.
- Mark unavailable information explicitly instead of silently substituting assumptions.
- Do not repeat the same information across multiple sections.
- Keep the report proportional to the complexity and importance of the task.

## Finding format

For each material finding, use the following fields where applicable:

- **Finding:** What was discovered?
- **Evidence:** What supports it?
- **Interpretation:** What does the evidence mean?
- **Impact:** Why does it matter?
- **Confidence:** How reliable is the conclusion?
- **Caveats:** What could invalidate or change it?

Do not force every field into trivial findings.

## Final validation

Before returning the Skill Run output, verify:

- The conclusion answers the skill's intended objective.
- Important claims are supported by evidence.
- Dates, units, comparisons, and calculations are internally consistent.
- Uncertainty and missing information are disclosed.
- Recommendations follow from the findings.
- Irrelevant sections and repetitive content have been removed.
- The report is readable and proportionate to the task.
