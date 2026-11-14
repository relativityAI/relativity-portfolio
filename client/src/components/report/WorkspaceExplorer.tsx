import { useMemo, useState } from "react";
import { Box, Flex, Text, Badge } from "@chakra-ui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Navigable view of the run's in-memory research workspace (the compacted
 * snapshot persisted in analysis_runs.workspace). File tree on the left,
 * markdown rendered / JSON pretty-printed on the right. `live` shows a badge
 * while the run is still updating the snapshot.
 */
export function WorkspaceExplorer({ workspace, live = false }: { workspace: Record<string, string>; live?: boolean }) {
    const paths = useMemo(() => Object.keys(workspace).sort(sortPaths), [workspace]);
    const [selected, setSelected] = useState(paths[0] ?? "");
    const content = workspace[selected] ?? "";

    if (!paths.length) {
        return (
            <Text fontSize="13px" color="var(--ink-tertiary)">
                No workspace snapshot for this run.
            </Text>
        );
    }

    const groups = groupPaths(paths);
    return (
        <Flex gap={0} border="1px solid var(--hairline)" borderRadius="6px" overflow="hidden" minH="360px">
            <Box w={{ base: "150px", md: "220px" }} flexShrink={0} borderRight="1px solid var(--hairline)" bg="var(--surface-raised)" overflowY="auto" maxH="560px" data-print-hide>
                {groups.map((g) => (
                    <Box key={g.label} py={1}>
                        <Text px={3} py={1} fontSize="11px" fontWeight={600} textTransform="uppercase" letterSpacing="0.04em" color="var(--ink-tertiary)">
                            {g.label}
                            <Text as="span" ml={1.5} fontWeight={400}>({g.paths.length})</Text>
                        </Text>
                        {g.paths.map((p) => (
                            <Flex
                                key={p}
                                as="button"
                                onClick={() => setSelected(p)}
                                align="center"
                                gap={1.5}
                                w="100%"
                                px={3}
                                py={1}
                                fontSize="12px"
                                textAlign="left"
                                bg={selected === p ? "var(--surface-canvas)" : "transparent"}
                                color={selected === p ? "var(--ink-primary)" : "var(--ink-secondary)"}
                                fontWeight={selected === p ? 600 : 400}
                                _hover={{ bg: "var(--surface-canvas)" }}
                                cursor="pointer"
                            >
                                <Text as="span" noOfLines={1} fontFamily="var(--font-mono, monospace)">
                                    {displayPath(p, g.label)}
                                </Text>
                            </Flex>
                        ))}
                    </Box>
                ))}
            </Box>
            <Box flex="1" overflowY="auto" maxH="560px" px={4} py={3}>
                <Flex align="center" gap={2} mb={3}>
                    <Text fontSize="12px" fontFamily="var(--font-mono, monospace)" color="var(--ink-secondary)" noOfLines={1}>
                        {selected}
                    </Text>
                    <Text fontSize="11px" color="var(--ink-tertiary)">· {(content.length / 1024).toFixed(1)} KB</Text>
                    {live && <Badge colorScheme="green" fontSize="10px">live</Badge>}
                </Flex>
                <WorkspaceFileBody path={selected} content={content} />
            </Box>
        </Flex>
    );
}

function WorkspaceFileBody({ path, content }: { path: string; content: string }) {
    if (path.endsWith(".md")) {
        return (
            <Box fontSize="13px" color="var(--ink-primary)" className="skill-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </Box>
        );
    }
    let text = content;
    if (path.endsWith(".json")) {
        try {
            text = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
            // truncated snapshot — render as-is
        }
    }
    return (
        <Box
            as="pre"
            fontSize="12px"
            fontFamily="var(--font-mono, monospace)"
            color="var(--ink-secondary)"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            m={0}
        >
            {text}
        </Box>
    );
}

interface Group {
    label: string;
    paths: string[];
}

function groupPaths(paths: string[]): Group[] {
    const map = new Map<string, string[]>();
    const root: string[] = [];
    for (const p of paths) {
        const rest = p.replace(/^\//, "");
        const slash = rest.indexOf("/");
        if (slash === -1) {
            root.push(p);
            continue;
        }
        const dir = rest.slice(0, slash);
        if (!map.has(dir)) map.set(dir, []);
        map.get(dir)!.push(p);
    }
    const groups: Group[] = [];
    if (root.length) groups.push({ label: "root", paths: root });
    for (const [dir, ps] of [...map.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        groups.push({ label: dir, paths: ps });
    }
    return groups;
}

/** index.md first, then control, then everything else alphabetically. */
function sortPaths(a: string, b: string): number {
    const rank = (p: string) => (p === "/index.md" ? 0 : p.startsWith("/control/") ? 1 : p.startsWith("/knowledge_base/") ? 2 : p.startsWith("/sources/") ? 3 : 4);
    return rank(a) - rank(b) || a.localeCompare(b);
}

function displayPath(path: string, group: string): string {
    const rest = path.replace(/^\//, "");
    return group === "root" ? rest : rest.slice(group.length + 1);
}
