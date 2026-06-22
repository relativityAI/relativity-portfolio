import { useEffect, useState } from "react"
import {
    Flex,
    Text,
    Spinner,
    Button
} from "@chakra-ui/react"

import DataSourceTable from "./DataSourceTable"
import { VoyagerService } from "@/db"

interface ProfileDataSourcesProps {
    data: any[];
    onUpdate: (data: any[]) => void;
    id: string;
    name: string;
}

export default function ProfileDataSources(props: ProfileDataSourcesProps) {
    const [dataSources, setDataSources] = useState(props.data || [])
    const [uniqueSources, setUniqueSources] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchSources = async () => {
        try {
            setLoading(true)
            setError(null)
            const sources = await VoyagerService.getSources()
            if (sources && sources.length > 0) {
                setUniqueSources(sources.map((s: string) => ({ source: s })))
            } else {
                setUniqueSources([])
            }
        } catch (error) {
            console.error("Error fetching sources from Voyager:", error)
            setError("Voyager API is unreachable. Cannot fetch available data sources.")
        } finally {
            setLoading(false)
        }
    }

    const updateDataSources = (index: number, newDataSource: any) => {
        const nds = [...dataSources]
        nds[index] = newDataSource
        setDataSources(nds)
        props.onUpdate(nds)
    }

    const addNewDataSource = (sourceName: string) => async () => {
        try {
            // Fetch schema for the new source to initialize it correctly
            console.log("Fetching schema for", sourceName)
            const schema = await VoyagerService.getSchema(sourceName)
            const newDS = {
                source: sourceName,
                image: (schema as any).image || "", 
                filters: [] 
            }
            const nds = [...dataSources, newDS]
            setDataSources(nds)
            props.onUpdate(nds)
        } catch (error) {
            console.error("Error adding source:", error)
        }
    }

    const removeDataSource = (idx: number) => {
        const reducedList = dataSources.filter((_, index: number) => index !== idx)
        setDataSources(reducedList)
        props.onUpdate(reducedList)
    }

    useEffect(() => {
        fetchSources()
    }, [])

    if (loading) return <Spinner />

    const selectedSourceNames = dataSources.map((ds: any) => ds.source)
    const availableSources = uniqueSources.filter(s => !selectedSourceNames.includes(s.source))

    return (
        <Flex direction={"column"} gap={10}>
            <Flex gap={2} direction={"column"}>
                <Flex justify="space-between" align="center">
                    <Text textStyle={"xl"} fontWeight={"bold"}>
                        Available Data Sources
                    </Text>
                    {error && (
                        <Flex align="center" gap={2} bg="red.50" p={2} rounded="md" border="1px solid" borderColor="red.200">
                            <Text color="red.600" fontSize="xs" fontWeight="medium">{error}</Text>
                        </Flex>
                    )}
                </Flex>
                
                <Flex wrap="wrap" gap={3}>
                    {availableSources.length > 0 ? (
                        availableSources.map((item) => (
                            <Button 
                                key={item.source}
                                size="xs"
                                variant="outline"
                                border="1px solid"
                                borderColor="border"
                                color="fg.muted"
                                bg="bg.muted"
                                py={4}
                                px={4}
                                rounded="sm"
                                onClick={addNewDataSource(item.source)}
                                _hover={{ 
                                    bg: "bg.emphasized", 
                                    color: "fg",
                                    borderColor: "border.emphasized",
                                    transform: "translateY(-1px)"
                                }}
                                transition="all 0.2s"
                            >
                                <Text fontSize="xs" fontWeight="bold" mr={2} color="fg.muted">{item.source[0].toUpperCase()}</Text>
                                {item.source}
                            </Button>
                        ))
                    ) : (
                        <Text textStyle={"sm"} color="fg.muted" fontStyle="italic">
                            {error ? "Voyager unreachable" : "No additional sources available"}
                        </Text>
                    )}
                </Flex>
            </Flex>

            <Flex direction="column" gap={8}>
                {dataSources.map((item: any, index: number) => (
                    <div key={`${item.source}-${index}`}>
                        <DataSourceTable
                            data={item}
                            index={index}
                            updateDataSources={updateDataSources}
                            removeDataSource={() => removeDataSource(index)}
                        />
                    </div>
                ))}
            </Flex>
        </Flex>
    )
}
