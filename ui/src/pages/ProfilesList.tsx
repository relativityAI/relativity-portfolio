import {
    Flex,
    Button,
    Table,
    Text,
    Box
} from "@chakra-ui/react"
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ProfileService } from "@/db";


interface Profile {
    _id: string;
    id?: string;
    name: string;
    created_at: string;
    qualitative?: any[];
    quantitative?: any[];
    data_sources?: any[];
}

export default function ProfilesList() {
    let navigate = useNavigate();

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
    }

    const handleCreate = () => {
        navigate("/profile/new");
    }

    const onRowClick = (id: string) => {
        window.open("/profile/" + id, "_blank");
    }

    useEffect(() => {
        fetchUniqueProfiles()
    }, [])

    return (
        <Flex direction={"column"} gap={6}>
            <Flex justify="space-between" align="center">
                <Text fontWeight="bold" textStyle="4xl" letterSpacing="tight">
                    Investor Profiles
                </Text>
                <Button
                    variant="outline"
                    colorPalette="gray"
                    size="sm"
                    loading={loading}
                    onClick={handleCreate}>
                    + Create New Profile
                </Button>
            </Flex>

            <Box border="1px solid" borderColor="border" rounded="md" overflow="hidden">
                <Table.Root size="sm" variant="line" interactive>
                    <Table.Header bg="bg.muted">
                        <Table.Row>
                            <Table.ColumnHeader color="fg.muted" py={4}>Name</Table.ColumnHeader>
                            <Table.ColumnHeader color="fg.muted" textAlign="center" py={4}>Qual</Table.ColumnHeader>
                            <Table.ColumnHeader color="fg.muted" textAlign="center" py={4}>Quant</Table.ColumnHeader>
                            <Table.ColumnHeader color="fg.muted" py={4}>Created At</Table.ColumnHeader>
                            <Table.ColumnHeader color="fg.muted" py={4}>ID</Table.ColumnHeader>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {fetchError ? (
                            <Table.Row>
                                <Table.Cell colSpan={5} textAlign="center" color="red.500" py={8}>
                                    Failed to fetch profiles. Profile API may be unavailable.
                                </Table.Cell>
                            </Table.Row>
                        ) : uniqueProfiles.length === 0 && !loading ? (
                            <Table.Row>
                                <Table.Cell colSpan={5} textAlign="center" color="fg.subtle" py={8}>
                                    No profiles found.
                                </Table.Cell>
                            </Table.Row>
                        ) : (
                            uniqueProfiles.map((item) => (
                                <Table.Row
                                    key={item._id || item.id}
                                    cursor="pointer"
                                    onClick={() => onRowClick(item._id || item.id as string)}
                                    _hover={{ bg: "bg.muted" }}
                                >
                                    <Table.Cell fontWeight="semibold" fontSize="sm" color="fg">{item.name}</Table.Cell>
                                    <Table.Cell textAlign="center" fontSize="xs" color="fg.subtle">{(item.qualitative || (item as any).qualitativeData)?.length || 0}</Table.Cell>
                                    <Table.Cell textAlign="center" fontSize="xs" color="fg.subtle">{item.quantitative?.length || 0}</Table.Cell>
                                    <Table.Cell fontSize="sm" color="fg.subtle">{item.created_at ? new Date(item.created_at).toLocaleString() : "N/A"}</Table.Cell>
                                    <Table.Cell fontSize="xs" color="fg.muted" fontFamily="mono">{item._id || item.id}</Table.Cell>
                                </Table.Row>
                            ))
                        )}
                    </Table.Body>
                </Table.Root>
            </Box>
        </Flex>
    )
}