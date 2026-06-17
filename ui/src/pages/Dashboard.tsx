import {
    Text,
    SimpleGrid,
    Flex,
    Box,
    Stat
} from "@chakra-ui/react"
import RelCard from "@/components/RelCard"
import { useState, useEffect } from "react"
import { ProfileService, AnalysisService } from "@/db"

// Show a little tutorial steps on the homepage
import { FaFilePen, FaBrain, FaListCheck } from "react-icons/fa6";


export default function Dashboard() {

    const logoSize = 60; // Slightly smaller to fit grid
    const [stats, setStats] = useState({
        profiles: 0,
        analysis: 0
    });

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const profiles = await ProfileService.listProfiles();
                const analyses = await AnalysisService.listAnalyses();
                setStats({
                    profiles: profiles.length || 0,
                    analysis: analyses.length || 0
                });
            } catch (error) {
                console.error("Error fetching dashboard stats:", error);
            }
        };
        fetchStats();
    }, []);

    return (
        <Flex direction={"column"} gap={8}>
            <Text
                textStyle={"5xl"}
                fontWeight="semibold"
            >
                Dashboard
            </Text>

            <Flex gap={12} align="stretch">
                {/* Left Side: Metadata (Stats) */}
                <Flex direction="column" gap={8} w="280px">
                    <Box p={6} border="1px solid" borderColor="gray.800" rounded="lg" bg="gray.900">
                        <Text fontWeight="bold" mb={6} color="gray.500" fontSize="xs" textTransform="uppercase" letterSpacing="widest">Overview</Text>
                        <Flex direction="column" gap={8}>
                            <Stat.Root>
                                <Stat.Label color="gray.400">Total Profiles</Stat.Label>
                                <Stat.ValueText fontSize="4xl" fontWeight="bold" mt={1}>{stats.profiles}</Stat.ValueText>
                                <Stat.HelpText color="blue.500" mt={1}>Active investment profiles</Stat.HelpText>
                            </Stat.Root>

                            <Stat.Root>
                                <Stat.Label color="gray.400">Total Analyses</Stat.Label>
                                <Stat.ValueText fontSize="4xl" fontWeight="bold" mt={1}>{stats.analysis}</Stat.ValueText>
                                <Stat.HelpText color="gray.500" mt={1}>Completed runs</Stat.HelpText>
                            </Stat.Root>
                        </Flex>
                    </Box>
                </Flex>

                {/* Right Side: Navigation Cards */}
                <SimpleGrid
                    columns={2}
                    gap={6}
                    flex={1}
                >
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
                    <RelCard
                        title="Screen Shares"
                        to="/"
                        description="Screen multiple shares on an investor profile"
                        button="Screen"
                        icon={<FaListCheck size={logoSize} />}
                    />
                </SimpleGrid>
            </Flex>
        </Flex>
    )
}


