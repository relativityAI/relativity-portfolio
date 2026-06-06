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
        <Flex direction={"column"} gap={1} border="1px solid" borderColor="gray.200" p={4} rounded="lg">
            <Flex align={"center"} justify={"space-between"} >
                <Flex align={"center"} gap={2}>
                    {dataSource.image ?
                        <Image rounded="md" height="30px" src={dataSource.image} />
                        :
                        <div style={{ width: '30px', height: '30px', backgroundColor: '#eee', borderRadius: '4px' }} />
                    }
                    <Text fontWeight="semibold" textStyle="2xl">{dataSource.source}</Text>
                    <Button size={"xs"} variant={"subtle"} onClick={() => setImgUrlEdit(!imgUrlEdit)}>
                        {imgUrlEdit ? <MdCheckCircle /> : <MdModeEdit />}
                    </Button>
                </Flex>

                <Flex gap={2} align={"center"}>
                    <Text textStyle={"xs"}>Add metric</Text>
                    <DropDown
                        color="purple"
                        options={availableMetrics}
                        onChange={addMetric}
                    />
                </Flex>
            </Flex>

            {imgUrlEdit && (
                <Input
                    size="xs"
                    placeholder="Enter Image URL"
                    value={dataSource.image}
                    onChange={handleImageChange}
                    mt={2}
                />
            )}

            <Table.Root key="line" size="sm" variant="line" mt={2}>
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
                        <Table.Row key={item.metric}>
                            <Table.Cell>
                                <Text fontWeight="medium">{item.title || item.metric}</Text>
                                <Text fontSize="2xs" color="gray.500">{item.type}</Text>
                            </Table.Cell>

                            <Table.Cell>
                                <DropDown
                                    initValue={item.direction}
                                    options={["higher", "lower", "equal"]}
                                    onChange={handleDataChange("direction", index)}
                                />
                            </Table.Cell>
                            <Table.Cell>
                                <Input
                                    variant="flushed"
                                    size="xs"
                                    width="60px"
                                    value={item.threshold}
                                    onChange={handleDataChange("threshold", index)}
                                />
                            </Table.Cell>
                            <Table.Cell>
                                <Flex gap={1} align="center">
                                    <Input
                                        variant="flushed"
                                        size="xs"
                                        width="40px"
                                        value={item.lower}
                                        onChange={handleDataChange("lower", index)}
                                    />
                                    <Text>-</Text>
                                    <Input
                                        variant="flushed"
                                        size="xs"
                                        width="40px"
                                        value={item.upper}
                                        onChange={handleDataChange("upper", index)}
                                    />
                                </Flex>
                            </Table.Cell>

                            <Table.Cell>
                                <Button size="xs" variant="ghost" colorPalette="red" onClick={deleteMetric(index)}>
                                    <MdDeleteForever size={18} />
                                </Button>
                            </Table.Cell>
                        </Table.Row>
                    ))}
                </Table.Body>
            </Table.Root>

            <Flex justify="space-between" align="center" mt={4}>
                <Text textStyle={"xs"} fontWeight={"semibold"}>
                    Metrics: <Kbd>{dataSource.filters.length}</Kbd> / {Object.keys(schema?.properties || {}).length}
                </Text>
                
                <Button
                    size={"xs"}
                    variant={"subtle"}
                    colorPalette={"red"}
                    onClick={props.removeDataSource}
                >
                    Remove Source <MdOutlineRemoveCircle />
                </Button>
            </Flex>
        </Flex>
    )
}
