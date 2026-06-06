import { useEffect, useState } from "react"
import {
    SimpleGrid,
    Flex,
    Text,
    Spinner
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
                
                <SimpleGrid columns={10} gap={4}>
                    {availableSources.length > 0 ? (
                        availableSources.map((item) => (
                            <Flex 
                                key={item.source} 
                                direction={"column"} 
                                gap={1} 
                                align={"center"}
                                cursor="pointer"
                                onClick={addNewDataSource(item.source)}
                                _hover={{ opacity: 0.8, transform: "translateY(-2px)" }}
                                transition={"all 0.2s"}
                            >
                                <div style={{ 
                                    width: '50px', 
                                    height: '50px', 
                                    backgroundColor: '#5099c9', 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'center',
                                    borderRadius: '12px',
                                    border: '1px solid #e2e8f0',
                                    fontWeight: 'bold',
                                    color: '#4a5568'
                                }}>
                                    {item.source[0].toUpperCase()}
                                </div>
                                <Text fontSize="2xs" fontWeight="semibold" textAlign="center">{item.source}</Text>
                            </Flex>
                        ))
                    ) : (
                        <Text textStyle={"sm"} color="gray.500">
                            {error ? "Connect to Voyager to browse sources" : "All available sources are already in this profile."}
                        </Text>
                    )}
                </SimpleGrid>
            </Flex>

            <SimpleGrid columns={2} gap="40px">
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
            </SimpleGrid>
        </Flex>
    )
}
