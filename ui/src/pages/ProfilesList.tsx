import {
    Flex,
    Button,
    Table,
    Text,
    Box,
    HStack,
    Spinner,
} from "@chakra-ui/react"
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ProfileService } from "@/db";

interface Profile {
    _id: string;
    id?: string;
    name: string;
    created_at: string;
    source?: string;
    asset_evaluation?: {
        qualitative?: any[];
        quantitative?: any[];
    };
}

export default function ProfilesList() {
    const navigate = useNavigate();

    const [uniqueProfiles, setUniqueProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(false);

    const fetchUniqueProfiles = async () => {
        try {
            setLoading(true);
            const data = await ProfileService.listProfiles();
            if (Array.isArray(data)) {
                setUniqueProfiles(data);
                setFetchError(false);
            } else {
                setUniqueProfiles([]);
                setFetchError(true);
            }
        } catch (error) {
            console.error("Error fetching profiles:", error);
            setUniqueProfiles([]);
            setFetchError(true);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = () => {
        navigate("/profile/new");
    };

    const onRowClick = (id: string) => {
        navigate("/profile/" + id);
    };

    const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
        e.stopPropagation();
        if (confirm(`Delete "${name || id}"?`)) {
            await ProfileService.deleteProfile(id);
            fetchUniqueProfiles();
        }
    };

    useEffect(() => {
        fetchUniqueProfiles();
    }, []);

    const colSpan = 4;

    return (
        <Box bg="var(--surface-canvas)" minH="100vh">
            <Flex direction="column" gap={6} maxW="1200px" mx="auto" px={6} py={6}>
                {/* Page header */}
                <Flex justify="space-between" align="center">
                    <Text fontSize="22px" fontWeight={600} color="var(--ink-primary)">
                        Portfolio Profiles
                    </Text>
                    <Button
                        size="sm"
                        onClick={handleCreate}
                        loading={loading}
                        bg="var(--accent-primary)"
                        color="#fff"
                        fontWeight={500}
                        fontSize="13px"
                        px={4}
                        _hover={{ opacity: 0.9 }}
                        borderRadius="3px"
                    >
                        + Create Profile
                    </Button>
                </Flex>

                {/* Table */}
                <Box
                    border="1px solid var(--hairline)"
                    borderRadius="2px"
                    overflow="hidden"
                    bg="var(--surface-panel)"
                >
                    <Box overflowX="auto">
                        <Table.Root size="sm" variant="line" minWidth="600px">
                            <Table.Header>
                                <Table.Row bg="var(--surface-recessed)">
                                    <Table.ColumnHeader
                                        fontSize="10.5px"
                                        fontWeight={500}
                                        letterSpacing="0.06em"
                                        textTransform="uppercase"
                                        color="var(--ink-tertiary)"
                                        py={3}
                                        px={4}
                                    >
                                        Name
                                    </Table.ColumnHeader>
                                    <Table.ColumnHeader
                                        fontSize="10.5px"
                                        fontWeight={500}
                                        letterSpacing="0.06em"
                                        textTransform="uppercase"
                                        color="var(--ink-tertiary)"
                                        py={3}
                                        px={4}
                                    >
                                        Criteria
                                    </Table.ColumnHeader>
                                    <Table.ColumnHeader
                                        fontSize="10.5px"
                                        fontWeight={500}
                                        letterSpacing="0.06em"
                                        textTransform="uppercase"
                                        color="var(--ink-tertiary)"
                                        py={3}
                                        px={4}
                                    >
                                        Created
                                    </Table.ColumnHeader>
                                    <Table.ColumnHeader py={3} px={4} w="48px" />
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {loading ? (
                                    <Table.Row>
                                        <Table.Cell colSpan={colSpan} py={12}>
                                            <Flex justify="center" gap={3} color="var(--ink-secondary)">
                                                <Spinner size="sm" borderWidth="2px" />
                                                <Text fontSize="13px">Loading profiles…</Text>
                                            </Flex>
                                        </Table.Cell>
                                    </Table.Row>
                                ) : fetchError ? (
                                    <Table.Row>
                                        <Table.Cell colSpan={colSpan} py={8} px={4}>
                                            <Flex justify="center">
                                                <Box borderLeft="3px solid var(--signal-negative)" pl={3}>
                                                    <Text fontSize="13px" color="var(--ink-primary)">
                                                        Failed to fetch profiles.
                                                    </Text>
                                                    <Text fontSize="12px" color="var(--ink-secondary)" mt={1}>
                                                        Profile API may be unavailable.
                                                    </Text>
                                                </Box>
                                            </Flex>
                                        </Table.Cell>
                                    </Table.Row>
                                ) : uniqueProfiles.length === 0 ? (
                                    <Table.Row>
                                        <Table.Cell
                                            colSpan={colSpan}
                                            textAlign="center"
                                            color="var(--ink-tertiary)"
                                            py={12}
                                            fontSize="13px"
                                        >
                                            No profiles found.
                                        </Table.Cell>
                                    </Table.Row>
                                ) : (
                                    uniqueProfiles.map((item) => {
                                        const qualCount =
                                            item.asset_evaluation?.qualitative?.length || 0;
                                        const quantCount =
                                            item.asset_evaluation?.quantitative?.length || 0;
                                        return (
                                            <Table.Row
                                                key={item._id || item.id}
                                                cursor="pointer"
                                                onClick={() =>
                                                    onRowClick(item._id || (item.id as string))
                                                }
                                                _hover={{ bg: "var(--surface-recessed)" }}
                                                transition="background 80ms"
                                            >
                                                {/* Name + ID sub-line */}
                                                <Table.Cell px={4} py={3}>
                                                    <Flex direction="column">
                                                        <Text
                                                            fontSize="13.5px"
                                                            fontWeight={500}
                                                            color="var(--ink-primary)"
                                                            lineHeight="short"
                                                        >
                                                            {item.name}
                                                        </Text>
                                                        <Text
                                                            fontSize="11px"
                                                            fontFamily="var(--font-mono)"
                                                            color="var(--ink-tertiary)"
                                                        >
                                                            {(item._id || item.id || "").slice(
                                                                0,
                                                                10
                                                            )}
                                                        </Text>
                                                    </Flex>
                                                </Table.Cell>

                                                {/* Criteria — merged qual + quant */}
                                                <Table.Cell px={4} py={3}>
                                                    <HStack gap={1}>
                                                        <Text
                                                            fontSize="13px"
                                                            fontFamily="var(--font-tabular)"
                                                            fontVariantNumeric="tabular-nums"
                                                            color="var(--ink-primary)"
                                                        >
                                                            {qualCount}
                                                        </Text>
                                                        <Text
                                                            fontSize="12px"
                                                            color="var(--ink-tertiary)"
                                                        >
                                                            qual
                                                        </Text>
                                                        <Text
                                                            fontSize="12px"
                                                            color="var(--ink-tertiary)"
                                                            mx={0.5}
                                                        >
                                                            ·
                                                        </Text>
                                                        <Text
                                                            fontSize="13px"
                                                            fontFamily="var(--font-tabular)"
                                                            fontVariantNumeric="tabular-nums"
                                                            color="var(--ink-primary)"
                                                        >
                                                            {quantCount}
                                                        </Text>
                                                        <Text
                                                            fontSize="12px"
                                                            color="var(--ink-tertiary)"
                                                        >
                                                            quant
                                                        </Text>
                                                    </HStack>
                                                </Table.Cell>

                                                {/* Created */}
                                                <Table.Cell
                                                    fontSize="13px"
                                                    color="var(--ink-secondary)"
                                                    px={4}
                                                    py={3}
                                                >
                                                    {item.created_at
                                                        ? new Date(
                                                              item.created_at
                                                          ).toLocaleDateString()
                                                        : "—"}
                                                </Table.Cell>

                                                {/* Delete */}
                                                <Table.Cell px={2} py={3}>
                                                    <Button
                                                        variant="ghost"
                                                        size="xs"
                                                        color="var(--ink-tertiary)"
                                                        _hover={{
                                                            color: "var(--signal-negative)",
                                                            bg: "transparent",
                                                        }}
                                                        px={1}
                                                        minW="auto"
                                                        onClick={(e) =>
                                                            handleDelete(
                                                                e,
                                                                item._id || item.id,
                                                                item.name
                                                            )
                                                        }
                                                    >
                                                        <svg
                                                            width="14"
                                                            height="14"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            strokeWidth="1.5"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                        >
                                                            <path d="M3 6h18" />
                                                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                                        </svg>
                                                    </Button>
                                                </Table.Cell>
                                            </Table.Row>
                                        );
                                    })
                                )}
                            </Table.Body>
                        </Table.Root>
                    </Box>
                </Box>
            </Flex>
        </Box>
    );
}
