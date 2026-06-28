import {
    Text,
    SimpleGrid,
    Flex,
    Box,
    Stat,
    Table,
    Badge,
    HStack,
    Spinner,
} from "@chakra-ui/react"
import RelCard from "@/components/RelCard"
import { useState, useEffect, useMemo } from "react"
import { ProfileService, AnalysisService } from "@/db"

import { FaFilePen, FaBrain } from "react-icons/fa6";
import { MdAnalytics, MdTrendingUp } from "react-icons/md";

function scoreColor(score: number): string {
    if (score >= 70) return "green";
    if (score >= 40) return "yellow";
    return "red";
}

export default function Dashboard() {
    const logoSize = 60;
    const [stats, setStats] = useState({ profiles: 0, analysis: 0 });
    const [analyses, setAnalyses] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const [profiles, analyses] = await Promise.all([
                    ProfileService.listProfiles(),
                    AnalysisService.listAnalyses(),
                ]);
                setStats({
                    profiles: profiles.length || 0,
                    analysis: analyses.length || 0,
                });
                setAnalyses(Array.isArray(analyses) ? analyses : []);
            } catch (error) {
                console.error("Error fetching dashboard stats:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, []);

    const completed = useMemo(() => {
        return analyses.filter(a =>
            a.total_score != null &&
            (a.status || "").toLowerCase() !== "failed" &&
            (a.status || "").toLowerCase() !== "error"
        );
    }, [analyses]);

    const topShares = useMemo(() => {
        const shareMap = new Map<string, { symbol: string; name: string; scores: number[]; count: number }>();

        completed.forEach(a => {
            const sym = a.symbol || a.share || "";
            const name = a.share_name || sym;
            if (!sym) return;
            if (!shareMap.has(sym)) shareMap.set(sym, { symbol: sym, name, scores: [], count: 0 });
            const entry = shareMap.get(sym)!;
            entry.scores.push(a.total_score);
            entry.count++;
        });

        return Array.from(shareMap.values())
            .map(e => ({
                symbol: e.symbol,
                name: e.name,
                count: e.count,
                avgScore: e.scores.reduce((a: number, b: number) => a + b, 0) / e.scores.length,
            }))
            .sort((a, b) => b.count - a.count || b.avgScore - a.avgScore)
            .slice(0, 5);
    }, [completed]);

    const topProfiles = useMemo(() => {
        const profileMap = new Map<string, { profile: string; scores: number[] }>();

        completed.forEach(a => {
            const prof = a.profile || a.profile_name || "";
            if (!prof) return;
            if (!profileMap.has(prof)) profileMap.set(prof, { profile: prof, scores: [] });
            profileMap.get(prof)!.scores.push(a.total_score);
        });

        return Array.from(profileMap.values())
            .map(e => ({
                profile: e.profile,
                count: e.scores.length,
                avgScore: e.scores.reduce((a: number, b: number) => a + b, 0) / e.scores.length,
            }))
            .sort((a, b) => b.avgScore - a.avgScore || b.count - a.count)
            .slice(0, 5);
    }, [completed]);

    return (
        <Flex direction={"column"} gap={4}>
            <Text textStyle={"5xl"} fontWeight="semibold">Dashboard</Text>

            <Flex gap={16} align="flex-start" wrap={{ base: "wrap", lg: "nowrap" }}>
                <Flex direction="column" gap={4} w={{ base: "full", lg: "280px" }} flexShrink={0}>
                    <Box p={4} border="1px solid" borderColor="border" rounded="lg" bg="bg.muted">
                        <Text fontWeight="bold" mb={3} color="fg.subtle" fontSize="xs" textTransform="uppercase" letterSpacing="widest">Overview</Text>
                        <Flex direction="column" gap={4}>
                            <Stat.Root>
                                <Stat.Label color="fg.muted">Total Profiles</Stat.Label>
                                <Stat.ValueText fontSize="3xl" fontWeight="bold" mt={0}>{stats.profiles}</Stat.ValueText>
                            </Stat.Root>
                            <Stat.Root>
                                <Stat.Label color="fg.muted">Total Analyses</Stat.Label>
                                <Stat.ValueText fontSize="3xl" fontWeight="bold" mt={0}>{stats.analysis}</Stat.ValueText>
                            </Stat.Root>
                        </Flex>
                    </Box>

                    {loading ? (
                        <Flex justify="center" py={6}>
                            <Spinner size="sm" />
                        </Flex>
                    ) : completed.length === 0 ? (
                        <Flex direction="column" align="center" gap={2} py={6} border="1px dashed" borderColor="border" rounded="md">
                            <MdTrendingUp size={20} />
                            <Text fontSize="xs" color="fg.muted">No completed analyses</Text>
                        </Flex>
                    ) : (
                        <Box border="1px solid" borderColor="border" rounded="md" overflow="hidden">
                            <Flex p={2} bg="bg.muted" borderBottom="1px solid" borderColor="border">
                                <HStack gap={1}>
                                    <MdAnalytics size={12} />
                                    <Text fontWeight="bold" color="fg.subtle" fontSize="2xs" textTransform="uppercase" letterSpacing="widest">Analytics</Text>
                                </HStack>
                            </Flex>
                            <Box p={2}>
                                <Text fontSize="xs" fontWeight="bold" color="fg.subtle" mb={1}>Top Shares</Text>
                                {topShares.length === 0 ? (
                                    <Text p={2} fontSize="xs" color="fg.muted">No data</Text>
                                ) : (
                                    <Table.Root size="xs" variant="line">
                                        <Table.Header>
                                            <Table.Row>
                                                <Table.ColumnHeader color="fg.muted" px={1}>#</Table.ColumnHeader>
                                                <Table.ColumnHeader color="fg.muted" px={1}>Symbol</Table.ColumnHeader>
                                                <Table.ColumnHeader color="fg.muted" px={1} textAlign="center">Runs</Table.ColumnHeader>
                                                <Table.ColumnHeader color="fg.muted" px={1} textAlign="right">Avg</Table.ColumnHeader>
                                            </Table.Row>
                                        </Table.Header>
                                        <Table.Body>
                                            {topShares.map((s, i) => (
                                                <Table.Row key={s.symbol}>
                                                    <Table.Cell px={1} color="fg.muted" fontSize="10px">{i + 1}</Table.Cell>
                                                    <Table.Cell px={1} fontWeight="medium" fontSize="sm">{s.symbol}</Table.Cell>
                                                    <Table.Cell px={1} textAlign="center">
                                                        <Badge variant="surface" colorPalette="gray" color="fg.muted" size="xs">{s.count}</Badge>
                                                    </Table.Cell>
                                                    <Table.Cell px={1} textAlign="right">
                                                        <Badge variant="surface" colorPalette={scoreColor(s.avgScore)} size="xs" fontWeight="bold">
                                                            {s.avgScore.toFixed(0)}%
                                                        </Badge>
                                                    </Table.Cell>
                                                </Table.Row>
                                            ))}
                                        </Table.Body>
                                    </Table.Root>
                                )}
                                <Text fontSize="xs" fontWeight="bold" color="fg.subtle" mt={2} mb={1}>Top Profiles</Text>
                                {topProfiles.length === 0 ? (
                                    <Text p={2} fontSize="xs" color="fg.muted">No data</Text>
                                ) : (
                                    <Table.Root size="xs" variant="line">
                                        <Table.Header>
                                            <Table.Row>
                                                <Table.ColumnHeader color="fg.muted" px={1}>#</Table.ColumnHeader>
                                                <Table.ColumnHeader color="fg.muted" px={1}>Profile</Table.ColumnHeader>
                                                <Table.ColumnHeader color="fg.muted" px={1} textAlign="center">Runs</Table.ColumnHeader>
                                                <Table.ColumnHeader color="fg.muted" px={1} textAlign="right">Avg</Table.ColumnHeader>
                                            </Table.Row>
                                        </Table.Header>
                                        <Table.Body>
                                            {topProfiles.map((p, i) => (
                                                <Table.Row key={p.profile}>
                                                    <Table.Cell px={1} color="fg.muted" fontSize="10px">{i + 1}</Table.Cell>
                                                    <Table.Cell px={1} fontWeight="medium" fontSize="sm" maxW="130px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{p.profile}</Table.Cell>
                                                    <Table.Cell px={1} textAlign="center">
                                                        <Badge variant="surface" colorPalette="gray" color="fg.muted" size="xs">{p.count}</Badge>
                                                    </Table.Cell>
                                                    <Table.Cell px={1} textAlign="right">
                                                        <Badge variant="surface" colorPalette={scoreColor(p.avgScore)} size="xs" fontWeight="bold">
                                                            {p.avgScore.toFixed(0)}%
                                                        </Badge>
                                                    </Table.Cell>
                                                </Table.Row>
                                            ))}
                                        </Table.Body>
                                    </Table.Root>
                                )}
                            </Box>
                        </Box>
                    )}
                </Flex>

                <SimpleGrid columns={2} gap={2} flex={1}>
                    <RelCard
                        title="Investor Profiles"
                        to="/profiles"
                        description="View or create a new investor profile"
                        button="View / Create"
                        icon={<FaFilePen size={logoSize} />}
                    />
                    <RelCard
                        title="Run Analysis"
                        to="/analysis-list"
                        description="Analyze shares on existing profiles"
                        button="Analyse"
                        icon={<FaBrain size={logoSize} />}
                    />
                </SimpleGrid>
            </Flex>
        </Flex>
    )
}
