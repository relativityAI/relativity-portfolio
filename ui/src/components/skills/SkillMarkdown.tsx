import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** YAML frontmatter at the very top of a SKILL.md — display-only, editors keep it. */
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Read-only rendering of a skill's SKILL.md body (`.skill-md`, styled in console.css). */
export function SkillMarkdown({ children }: { children: string }) {
    const body = children.replace(FRONTMATTER_RE, "");
    return (
        <div className="skill-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </div>
    );
}
