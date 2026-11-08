/**
 * Read/write a SKILL.md's `metadata.tags` line (comma-separated string).
 * String-level editing on purpose — the UI has no YAML dependency and the
 * frontmatter block is the document's source of truth.
 */

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;
const TAGS_LINE_RE = /^[ \t]+tags:[ \t]*(.*)$/m;

/** Tags from the frontmatter, trimmed and without blanks. */
export function getSkillTags(md: string): string[] {
    const fm = md.match(FM_RE)?.[1] ?? "";
    const line = fm.match(TAGS_LINE_RE);
    if (!line) return [];
    const raw = line[1].trim().replace(/^["']|["']$/g, "");
    return raw.split(",").map((t) => t.trim()).filter(Boolean);
}

/** Replace (or add) the metadata.tags line; empty value clears it. */
export function setSkillTags(md: string, value: string): string {
    const quoted = JSON.stringify(value);
    const m = md.match(FM_RE);
    if (!m) {
        return value ? `---\nmetadata:\n  tags: ${quoted}\n---\n\n${md}` : md;
    }
    let fm = m[1];
    if (/^[ \t]+tags:/m.test(fm)) {
        fm = fm.replace(/^([ \t]+)tags:.*$/m, (_s, ind) => `${ind}tags: ${quoted}`);
    } else if (value) {
        if (/^metadata:/m.test(fm)) {
            fm = fm.replace(/^metadata:.*$/m, (line) => `${line}\n  tags: ${quoted}`);
        } else {
            fm = `metadata:\n  tags: ${quoted}\n${fm}`;
        }
    }
    // m[2] starts after the newline the regex consumed following the closing
    // "---" — put that newline back or every call eats one.
    return `---\n${fm}\n---\n${m[2]}`;
}
