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
        <Flex direction={"column"} gap={1} border="1px solid" borderColor="border" p={6} rounded="sm" bg="bg.muted">
            <Flex align={"center"} justify={"space-between"} >
                <Flex align={"center"} gap={3}>
                    {dataSource.image ?
                        <Image rounded="sm" height="32px" src={dataSource.image} border="1px solid" borderColor="border" />
                        :
                        <Flex w="32px" h="32px" bg="bg.emphasized" rounded="sm" align="center" justify="center" border="1px solid" borderColor="border.emphasized">
                            <Text fontSize="xs" color="fg.subtle" fontWeight="bold">{dataSource.source[0].toUpperCase()}</Text>
                        </Flex>
                    }
                    <Text fontWeight="bold" textStyle="3xl" letterSpacing="tight" color="fg">{dataSource.source}</Text>
                    <Button size={"xs"} variant={"ghost"} onClick={() => setImgUrlEdit(!imgUrlEdit)} color="fg.subtle" _hover={{ color: "fg", bg: "transparent" }}>
                        {imgUrlEdit ? <MdCheckCircle /> : <MdModeEdit />}
                    </Button>
                </Flex>

                <Flex gap={3} align={"center"}>
                    <Text fontSize={"xs"} color="fg.muted" fontWeight="bold" letterSpacing="widest">ADD METRIC</Text>
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
                    bg="bg.subtle"
                    borderColor="border"
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
                        <Table.Row key={item.metric} _hover={{ bg: "bg.subtle" }}>
                            <Table.Cell py={4}>
                                <Text fontWeight="bold" fontSize="sm" color="fg">{item.title || item.metric}</Text>
                                <Text fontSize="2xs" color="fg.muted" letterSpacing="widest" mt={0.5}>{item.type?.toUpperCase()}</Text>
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
                                    bg="bg.subtle"
                                    borderColor="border"
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
                                        bg="bg.subtle"
                                        borderColor="border"
                                        px={2}
                                    />
                                    <Text color="fg.muted">-</Text>
                                    <Input
                                        variant="subtle"
                                        size="xs"
                                        width="50px"
                                        value={item.upper}
                                        onChange={handleDataChange("upper", index)}
                                        bg="bg.subtle"
                                        borderColor="border"
                                        px={2}
                                    />
                                </Flex>
                            </Table.Cell>

                            <Table.Cell py={4} textAlign="right">
                                <Button size="xs" variant="ghost" color="fg.muted" _hover={{ color: "red.400", bg: "transparent" }} onClick={deleteMetric(index)}>
                                    <MdDeleteForever size={18} />
                                </Button>
                            </Table.Cell>
                        </Table.Row>
                    ))}
                </Table.Body>
            </Table.Root>

            <Flex justify="space-between" align="center" mt={6}>
                <Text textStyle={"xs"} fontWeight={"bold"} color="fg.muted" letterSpacing="widest">
                    METRICS: <Kbd rounded="sm" bg="bg.emphasized" color="fg.muted" border="1px solid" borderColor="border.emphasized">{dataSource.filters.length}</Kbd> / {Object.keys(schema?.properties || {}).length}
                </Text>
                
                <Button
                    size={"xs"}
                    variant={"ghost"}
                    color="fg.muted"
                    _hover={{ color: "red.500", bg: "transparent" }}
                    onClick={props.removeDataSource}
                >
                    DELETE SOURCE <MdOutlineRemoveCircle />
                </Button>
            </Flex>
        </Flex>
    )
}
