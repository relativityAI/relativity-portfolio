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

            <Flex gap={16} align="flex-start">
                {/* Left Side: Metadata (Stats) */}
                <Flex direction="column" gap={8} w="30%">
                    <Box p={6} border="0.5px solid" borderColor="gray.700" rounded="4xl">
                        <Text fontWeight="bold" mb={4} color="gray.500" fontSize="xs" textTransform="uppercase">Overview</Text>
                        <Flex direction="column" gap={6}>
                            <Stat.Root>
                                <Stat.Label>Total Profiles</Stat.Label>
                                <Stat.ValueText fontSize="4xl" fontWeight="bold">{stats.profiles}</Stat.ValueText>
                                <Stat.HelpText color="blue.500">Active investor profiles</Stat.HelpText>
                            </Stat.Root>

                            <Stat.Root>
                                <Stat.Label>Total Analyses</Stat.Label>
                                <Stat.ValueText fontSize="4xl" fontWeight="bold">{stats.analysis}</Stat.ValueText>
                                <Stat.HelpText color="gray.400">Analyses run</Stat.HelpText>
                            </Stat.Root>
                        </Flex>
                    </Box>


                </Flex>

                {/* Right Side: Navigation Cards */}
                <SimpleGrid
                    columns={2}
                    gap={8}
                    w="70%"
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


