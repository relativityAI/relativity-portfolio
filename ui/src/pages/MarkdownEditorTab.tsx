import { Box, Text, Textarea, Button, Flex, Spinner } from "@chakra-ui/react"
import { MdOutlineFactCheck, MdOutlineFormatAlignLeft } from "react-icons/md"

export interface MdIssue {
    line: number;
    message: string;
    severity: "warn" | "error";
}

interface Props {
    md: string;
    onChange: (md: string) => void;
    issues: MdIssue[];
    onValidate: () => void;
    validating: boolean;
    saved?: boolean;
    /** When provided, shows an "Apply to section" action for pasted markdown. */
    onApply?: () => void;
    applyDisabled?: boolean;
    applying?: boolean;
}

/**
 * Raw Markdown editor tab. The backend owns validation (parse + schema);
 * this component only edits text and surfaces the returned issues.
 * Severity "error" issues block saving (handled by the parent).
 */
export default function MarkdownEditorTab({ md, onChange, issues, onValidate, validating, saved, onApply, applyDisabled, applying }: Props) {
    const errorCount = issues.filter((i) => i.severity === "error").length
    const warnCount = issues.filter((i) => i.severity === "warn").length

    return (
        <Flex direction="column" gap={3} w="full" data-testid="md-editor">
            <Text fontSize="11px" color="var(--ink-tertiary)">
                This section's markdown only — the rest of the agent is left untouched. Apply parses it back into the form.
            </Text>
            <Textarea
                value={md}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Paste or edit the agent markdown file.

Frontmatter: name, source, description, investment_horizon, risk_appetite.
Sections: ## Philosophy, ## Asset Evaluation / ## Macro Evaluation with
### Qualitative (#### Name — weight N) and ### Quantitative (| Metric | Rule | Weight |).
Anything else is preserved verbatim."
                minH="260px"
                fontFamily="var(--font-mono)"
                fontSize="13px"
                lineHeight="1.6"
                data-testid="md-input"
            />
            <Flex gap={2} align="center" flexWrap="wrap">
                <Button
                    size="sm"
                    variant="subtle"
                    color="var(--ink-secondary)"
                    alignSelf="flex-start"
                    onClick={onValidate}
                    loading={validating}
                    data-testid="md-validate"
                >
                    <MdOutlineFactCheck size={15} />
                    Validate
                </Button>
                {onApply && (
                    <Button
                        size="sm"
                        variant="surface"
                        colorPalette="blue"
                        alignSelf="flex-start"
                        onClick={onApply}
                        disabled={applyDisabled}
                        loading={applying}
                        data-testid="md-apply"
                    >
                        Apply to section
                    </Button>
                )}
            </Flex>
            {applyDisabled && <Text fontSize="11px" color="var(--signal-caution)">Fix the errors above before applying — this section won't parse cleanly.</Text>}
            <Box flex={1} minH="40px" data-testid="md-issues">
                {validating ? (
                    <Flex gap={2} align="center" color="var(--ink-tertiary)" fontSize="12px">
                        <Spinner size="xs" />
                        Validating…
                    </Flex>
                ) : issues.length ? (
                    <Flex direction="column" gap={1}>
                        {issues.map((issue, i) => (
                            <Text
                                key={i}
                                fontSize="12px"
                                fontFamily="var(--font-mono)"
                                color={issue.severity === "error" ? "var(--signal-negative)" : "var(--signal-caution)"}
                                data-testid="md-issue"
                            >
                                {issue.line ? `L${issue.line}: ` : ""}
                                {issue.message}
                            </Text>
                        ))}
                    </Flex>
                ) : saved ? (
                    <Text fontSize="12px" color="var(--signal-positive)" data-testid="md-saved">
                        <MdOutlineFormatAlignLeft /> Saved
                    </Text>
                ) : null}
            </Box>
            {issues.length > 0 && (
                <Text fontSize="11px" color="var(--ink-tertiary)">
                    {errorsLabel(errorCount, warnCount)}
                </Text>
            )}
        </Flex>
    )
}

function errorsLabel(errors: number, warns: number): string {
    if (errors) return `${errors} error${errors === 1 ? "" : "s"} — save is blocked. Fix the highlighted lines first.`
    if (warns) return `${warns} warning${warns === 1 ? "" : "s"} (informational, save allowed).`
    return ""
}