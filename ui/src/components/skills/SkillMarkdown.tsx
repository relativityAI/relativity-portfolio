import { Box } from "@/compat/ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Read-only rendering of a skill's SKILL.md body. */
export function SkillMarkdown({ children }: { children: string }) {
    return (
        <Box
            fontSize="13px"
            color="var(--ink-secondary)"
            lineHeight="1.65"
            css={{
                "& h1, & h2, & h3, & h4": {
                    color: "var(--ink-primary)",
                    fontWeight: 600,
                    fontFamily: "var(--font-body)",
                    lineHeight: 1.35,
                    marginTop: "1.1em",
                    marginBottom: "0.45em",
                },
                "& h1": { fontSize: "1.3em" },
                "& h2": { fontSize: "1.15em" },
                "& h3": { fontSize: "1.05em" },
                "& h4": { fontSize: "1em" },
                "& p": { margin: "0.5em 0" },
                "& ul": { listStyle: "disc outside", paddingLeft: "1.4em", margin: "0.5em 0" },
                "& ol": { listStyle: "decimal outside", paddingLeft: "1.4em", margin: "0.5em 0" },
                "& li": { margin: "0.18em 0" },
                "& strong": { color: "var(--ink-primary)", fontWeight: 600 },
                "& em": { color: "var(--ink-primary)" },
                "& blockquote": {
                    borderLeft: "2px solid var(--hairline)",
                    margin: "0.7em 0",
                    paddingLeft: "1em",
                    color: "var(--ink-tertiary)",
                },
                "& code": {
                    background: "var(--surface-recessed)",
                    borderRadius: "4px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.9em",
                    padding: "0.15em 0.35em",
                },
                "& pre": {
                    background: "var(--surface-recessed)",
                    borderRadius: "8px",
                    fontSize: "12px",
                    overflowX: "auto",
                    padding: "12px",
                    margin: "0.7em 0",
                },
                "& pre code": { background: "transparent", padding: 0 },
                "& table": { borderCollapse: "collapse", display: "block", overflowX: "auto", width: "100%", margin: "0.7em 0" },
                "& th, & td": { borderBottom: "1px solid var(--hairline)", padding: "0.4em 0.6em", textAlign: "left" },
                "& th": { color: "var(--ink-primary)", fontWeight: 600 },
                "& a": { color: "var(--accent-primary)", textDecoration: "underline" },
            }}
        >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
        </Box>
    );
}