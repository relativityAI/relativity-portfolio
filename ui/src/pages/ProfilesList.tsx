import {
    Flex,
    Button,
    Table,
    Text
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
    data_sources?: any[];
}

export default function ProfilesList() {
    let navigate = useNavigate();

    const variant = "outline"
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

    const handleCreate = async () => {
        try {
            const data = await ProfileService.createProfile();
            if (data && (data.id || data._id)) {
                const id = data.id || data._id;
                navigate("/profile/" + id);
            }
        } catch (error) {
            console.error("Error creating profile:", error);
        }
    }

    const onRowClick = (id: string) => {
        window.open("/profile/" + id, "_blank");
    }

    useEffect(() => {
        fetchUniqueProfiles()
    }, [])

    return (
        <Flex direction={"column"} gap={3}>
            <Flex>
                <Text fontWeight="semibold" textStyle="5xl">
                    Investor Profiles
                </Text>
            </Flex>

            <Table.Root key={variant} size="sm" variant={variant} interactive>
                <Table.Header>
                    <Table.Row >
                        <Table.ColumnHeader>Name</Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="center">Params</Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="center">Sources</Table.ColumnHeader>
                        <Table.ColumnHeader>Created At</Table.ColumnHeader>
                        <Table.ColumnHeader>ID</Table.ColumnHeader>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {fetchError ? (
                        <Table.Row>
                            <Table.Cell colSpan={5} textAlign="center" color="red.500">
                                Failed to fetch profiles. Profile API may be unavailable.
                            </Table.Cell>
                        </Table.Row>
                    ) : uniqueProfiles.length === 0 && !loading ? (
                        <Table.Row>
                            <Table.Cell colSpan={5} textAlign="center" color="gray.500">
                                No profiles found.
                            </Table.Cell>
                        </Table.Row>
                    ) : (
                        uniqueProfiles.map((item) => (
                            <Table.Row
                                key={item._id || item.id}
                                cursor="pointer"
                                onClick={() => onRowClick(item._id || item.id as string)}
                                _hover={{ bg: "gray.800" }}
                            >
                                <Table.Cell fontWeight="bold">{item.name}</Table.Cell>
                                <Table.Cell textAlign="center">{(item.qualitative || (item as any).qualitativeData)?.length || 0}</Table.Cell>
                                <Table.Cell textAlign="center">{(item.data_sources || (item as any).dataSources)?.length || 0}</Table.Cell>
                                <Table.Cell fontSize="sm">{item.created_at ? new Date(item.created_at).toLocaleString() : "N/A"}</Table.Cell>
                                <Table.Cell fontSize="xs" color="gray.400">{item._id || item.id}</Table.Cell>
                            </Table.Row>
                        ))
                    )}
                </Table.Body>
            </Table.Root>

            <Button
                variant={"surface"}
                loading={loading}
                onClick={handleCreate}>
                + Create New Profile
            </Button>
        </Flex>
    )
}