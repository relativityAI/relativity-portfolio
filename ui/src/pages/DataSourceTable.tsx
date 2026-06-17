import {
    Flex,
    Text,
    Table,
    Image,
    Input,
    Button,
    Spinner,
    Kbd
} from "@chakra-ui/react"
import DropDown from "@/components/DropDown"
import {
    MdModeEdit,
    MdDeleteForever,
    MdCheckCircle,
    MdOutlineRemoveCircle
} from "react-icons/md";
import { useEffect, useState } from "react";
import { VoyagerService } from "@/db";

interface DataSourceTableProps {
    data: any;
    index: number;
    updateDataSources: (index: number, data: any) => void;
    removeDataSource: () => void;
}

export default function DataSourceTable(props: DataSourceTableProps) {
    const [dataSource, setDataSource] = useState(props.data)
    const [schema, setSchema] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [imgUrlEdit, setImgUrlEdit] = useState(false)

    const fetchSchema = async () => {
        try {
            setLoading(true)
            const data = await VoyagerService.getSchema(dataSource.source)
            setSchema(data)
        } catch (error) {
            console.error("Error fetching schema:", error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchSchema()
    }, [dataSource.source])

    const deleteMetric = (index: number) => () => {
        const reducedList = dataSource.filters.filter((_: any, idx: number) => idx !== index)
        const newDataSource = { ...dataSource, filters: reducedList }
        setDataSource(newDataSource)
        props.updateDataSources(props.index, newDataSource)
    }

    const addMetric = (e: any) => {
        const newMetricName = e.target.value
        if (!newMetricName) return

        const existingMetrics = dataSource.filters.map((f: any) => f.metric)
        if (existingMetrics.includes(newMetricName)) {
            console.log("Already exists: " + newMetricName)
            return
        }

        const property = schema.properties[newMetricName]
        const newFilter = {
            metric: newMetricName,
            direction: "higher",
            threshold: property.default !== undefined ? property.default : 0,
            lower: 0,
            upper: 0,
            title: property.title || newMetricName,
            type: property.type || "string"
        }

        const newDataSource = {
            ...dataSource,
            filters: [...dataSource.filters, newFilter]
        }
        setDataSource(newDataSource)
        props.updateDataSources(props.index, newDataSource)
        
        // Reset dropdown if possible or just let it be
    }

    const handleDataChange = (field: string, index: number) => (e: any) => {
        const newFilters = [...dataSource.filters]
        newFilters[index] = {
            ...newFilters[index],
            [field]: e.target.value
        }
        const newDataSource = { ...dataSource, filters: newFilters }
        setDataSource(newDataSource)
        props.updateDataSources(props.index, newDataSource)
    }

    const handleImageChange = (e: any) => {
        const newDataSource = { ...dataSource, image: e.target.value }
        setDataSource(newDataSource)
        props.updateDataSources(props.index, newDataSource)
    }

    if (loading) return <Spinner />

    const availableMetrics = schema?.properties 
        ? Object.keys(schema.properties).filter(m => !dataSource.filters.some((f: any) => f.metric === m))
        : []

    return (
        <Flex direction={"column"} gap={1} border="1px solid" borderColor="gray.800" p={6} rounded="sm" bg="gray.900">
            <Flex align={"center"} justify={"space-between"} >
                <Flex align={"center"} gap={3}>
                    {dataSource.image ?
                        <Image rounded="sm" height="32px" src={dataSource.image} border="1px solid" borderColor="gray.800" />
                        :
                        <Flex w="32px" h="32px" bg="gray.800" rounded="sm" align="center" justify="center" border="1px solid" borderColor="gray.700">
                            <Text fontSize="xs" color="gray.500" fontWeight="bold">{dataSource.source[0].toUpperCase()}</Text>
                        </Flex>
                    }
                    <Text fontWeight="bold" textStyle="3xl" letterSpacing="tight" color="gray.200">{dataSource.source}</Text>
                    <Button size={"xs"} variant={"ghost"} onClick={() => setImgUrlEdit(!imgUrlEdit)} color="gray.500" _hover={{ color: "white", bg: "transparent" }}>
                        {imgUrlEdit ? <MdCheckCircle /> : <MdModeEdit />}
                    </Button>
                </Flex>

                <Flex gap={3} align={"center"}>
                    <Text fontSize={"xs"} color="gray.600" fontWeight="bold" letterSpacing="widest">ADD METRIC</Text>
                    <DropDown
                        options={availableMetrics}
                        onChange={addMetric}
                        width="200px"
                    />
                </Flex>
            </Flex>

            {imgUrlEdit && (
                <Input
                    variant="subtle"
                    size="xs"
                    placeholder="Enter Image URL"
                    value={dataSource.image}
                    onChange={handleImageChange}
                    mt={4}
                    bg="gray.950"
                    borderColor="gray.800"
                />
            )}

            <Table.Root key="line" size="sm" variant="line" mt={6}>
                <Table.Header>
                    <Table.Row>
                        <Table.ColumnHeader>Metric</Table.ColumnHeader>
                        <Table.ColumnHeader>Direction</Table.ColumnHeader>
                        <Table.ColumnHeader>Threshold</Table.ColumnHeader>
                        <Table.ColumnHeader>Range (L-U)</Table.ColumnHeader>
                        <Table.ColumnHeader></Table.ColumnHeader>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {dataSource.filters.map((item: any, index: number) => (
                        <Table.Row key={item.metric} _hover={{ bg: "gray.950" }}>
                            <Table.Cell py={4}>
                                <Text fontWeight="bold" fontSize="sm" color="gray.300">{item.title || item.metric}</Text>
                                <Text fontSize="2xs" color="gray.600" letterSpacing="widest" mt={0.5}>{item.type?.toUpperCase()}</Text>
                            </Table.Cell>

                            <Table.Cell py={4}>
                                <DropDown
                                    initValue={item.direction}
                                    options={["higher", "lower", "equal"]}
                                    onChange={handleDataChange("direction", index)}
                                />
                            </Table.Cell>
                            <Table.Cell py={4}>
                                <Input
                                    variant="subtle"
                                    size="xs"
                                    width="70px"
                                    value={item.threshold}
                                    onChange={handleDataChange("threshold", index)}
                                    bg="gray.950"
                                    borderColor="gray.800"
                                    px={2}
                                />
                            </Table.Cell>
                            <Table.Cell py={4}>
                                <Flex gap={2} align="center">
                                    <Input
                                        variant="subtle"
                                        size="xs"
                                        width="50px"
                                        value={item.lower}
                                        onChange={handleDataChange("lower", index)}
                                        bg="gray.950"
                                        borderColor="gray.800"
                                        px={2}
                                    />
                                    <Text color="gray.700">-</Text>
                                    <Input
                                        variant="subtle"
                                        size="xs"
                                        width="50px"
                                        value={item.upper}
                                        onChange={handleDataChange("upper", index)}
                                        bg="gray.950"
                                        borderColor="gray.800"
                                        px={2}
                                    />
                                </Flex>
                            </Table.Cell>

                            <Table.Cell py={4} textAlign="right">
                                <Button size="xs" variant="ghost" color="gray.700" _hover={{ color: "red.400", bg: "transparent" }} onClick={deleteMetric(index)}>
                                    <MdDeleteForever size={18} />
                                </Button>
                            </Table.Cell>
                        </Table.Row>
                    ))}
                </Table.Body>
            </Table.Root>

            <Flex justify="space-between" align="center" mt={6}>
                <Text textStyle={"xs"} fontWeight={"bold"} color="gray.600" letterSpacing="widest">
                    METRICS: <Kbd rounded="sm" bg="gray.800" color="gray.400" border="1px solid" borderColor="gray.700">{dataSource.filters.length}</Kbd> / {Object.keys(schema?.properties || {}).length}
                </Text>
                
                <Button
                    size={"xs"}
                    variant={"ghost"}
                    color="gray.600"
                    _hover={{ color: "red.500", bg: "transparent" }}
                    onClick={props.removeDataSource}
                >
                    DELETE SOURCE <MdOutlineRemoveCircle />
                </Button>
            </Flex>
        </Flex>
    )
}
