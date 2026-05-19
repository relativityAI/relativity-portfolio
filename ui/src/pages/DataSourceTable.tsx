import {
    Flex,
    Text,
    Table,
    Image,
    Input,
    Button
} from "@chakra-ui/react"
import DropDown from "@/components/DropDown"
import {
    MdModeEdit,
    MdDeleteForever,
    MdCheckCircle,
} from "react-icons/md";
import { useEffect, useState } from "react";

export default function DataSourceTable(props) {


    const imageUrl = props.data.image
    const source = props.data.source
    const sourceIndex = props.index

    const [availableMetrics, setAvailableMetrics] = useState([])

    const [metrics, setMetrics] = useState([])


    const [dataSource, setDataSource] = useState(props.data)
    const [imgUrlEdit, setImgUrlEdit] = useState(false)


    const handleAvailableMetrics = () => {
        const tempAvMet = []

        if (props.metrics) {
            console.log(props.metrics)

            for (const m of props.metrics) {
                let met = props.metrics[m]

                console.log(met)
                console.log(dataSource.filters)

                if (!dataSource.filters.includes(met)) {
                    tempAvMet.push(met)
                }
            }
            setAvailableMetrics(tempAvMet)

        }
        return tempAvMet

    }


    const deleteMetric = (index) => (e) => {
        console.log("Supposed to delete: " + index)

        let deletedAt;

        let reducedList = dataSource.filters.filter((metric, idx) => {
            if (idx == index) {
                deletedAt = index;
                return false;
            }
            return true;
        }).map((item, idx) => {
            if (idx >= deletedAt) return { ...item, order: item.order - 1 };
            else return item;
        })

        setDataSource({
            ...dataSource,
            filters: reducedList
        })

    }


    const addMetric = (e) => {

        const uniqueMetrics = []
        for (const metric of dataSource.filters) {
            uniqueMetrics.push(metric.metric)
        }

        const newMetric = e.target.value

        if (!uniqueMetrics.includes(newMetric)) {

            let newFilters = dataSource.filters
            newFilters[dataSource.filters.length] = {
                direction: "higher",
                lower: 0,
                upper: 0,
                threshold: 0,
                metric: newMetric
            }

            // console.log(dataSource.filters)
            // console.log(newFilters)

            const newDataSource = {
                    ...dataSource,
                    filters: newFilters
                }
            setDataSource(newDataSource)
        } else {
            console.log("Already exsists: " + newMetric)
        }


    }

    const handleImageEdit = () => {
        setImgUrlEdit(!imgUrlEdit)
    }

    const handleImageChange = (e) => {
        setDataSource(
            {
                ...dataSource,
                image: e.target.value
            }
        )
    }

    const handleDataChange = (field, item, index) => (e) => {

        let newDataSource = { ...dataSource }
        newDataSource.filters[index] = {
            ...item,
            [field]: e.target.value
        }
        setDataSource(newDataSource)

    }

    useEffect(() => {
        let nonSelectedAvailableMetrics = []
        // setAvailableMetrics(props.metrics)

        let existingFilters = []
        for (const f of props.metrics) {
            existingFilters.push(f.metric)
        }
        let availableFilters = []
        for (const f of dataSource.filters) {
            availableFilters.push(f.metric)
        }


        if (existingFilters) {
            for (const m of existingFilters) {
                // console.log(m)
                if (!availableFilters.includes(m)){
                    nonSelectedAvailableMetrics.push(m)
                }

            }
            setAvailableMetrics(nonSelectedAvailableMetrics)
        }

    }, [dataSource, props.metrics])

    useEffect(() => {
        // everytime anything changes, i wanna update the parent datasources
        props.updateDataSources(sourceIndex, dataSource)

        // console.log("Should update metrics")
        // handleAvailableMetrics()

    }, [dataSource])


    return (
        <Flex direction={"column"} gap={1}>
            <Flex align={"center"} justify={"space-between"} >


                <Flex align={"center"} gap={2}>

                    {imageUrl ?
                        <Image rounded="md" height="30px" src={dataSource.image} alt="John Doe" />
                        :
                        null
                    }
                    <Text fontWeight="semibold" textStyle="3xl">{source}</Text>
                    <Button
                        size={"xs"}
                        variant={"subtle"}
                        onClick={handleImageEdit}
                    >
                        {
                            imgUrlEdit ?
                                <MdCheckCircle />
                                :
                                <MdModeEdit />
                        }

                    </Button>

                </Flex>

                <Flex gap={1} align={"center"}>
                    <Text textStyle={"xs"}>Add metric</Text>
                    <DropDown
                        color="purple"
                        options={availableMetrics}
                        onChange={addMetric}

                    />
                </Flex>




            </Flex>
            {
                imgUrlEdit ?
                    <Input
                        size="xs"
                        placeholder="Enter URL"
                        value={dataSource.image}
                        onChange={handleImageChange}
                    />
                    :
                    null
            }
            <Table.Root key="line" size="sm" variant="line">

                <Table.Header>
                    <Table.Row>
                        <Table.ColumnHeader>Metric</Table.ColumnHeader>
                        <Table.ColumnHeader>Direction</Table.ColumnHeader>
                        <Table.ColumnHeader>Threshold</Table.ColumnHeader>
                        <Table.ColumnHeader>Lower</Table.ColumnHeader>
                        <Table.ColumnHeader>Upper</Table.ColumnHeader>
                        <Table.ColumnHeader></Table.ColumnHeader>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {dataSource.filters.map((item, index) => (
                        <Table.Row key={item.metric}>
                            {/* <MdDeleteForever size={20} /> */}
                            <Table.Cell>{item.metric}</Table.Cell>

                            <Table.Cell>
                                <DropDown
                                    initValue={item.direction}
                                    value={item.direction}
                                    options={["higher", "lower"]}
                                    onChange={handleDataChange("direction", item, index)}

                                />
                            </Table.Cell>
                            <Table.Cell>
                                <Input
                                    variant="flushed"
                                    maxW="10lh"
                                    value={item.threshold}
                                    onChange={handleDataChange("threshold", item, index)}
                                />

                            </Table.Cell>
                            <Table.Cell>
                                <Input
                                    variant="flushed"
                                    maxW="10lh"
                                    value={item.lower}
                                    onChange={handleDataChange("lower", item, index)}
                                />
                            </Table.Cell>
                            <Table.Cell>
                                <Input
                                    variant="flushed"
                                    maxW="10lh"
                                    value={item.upper}
                                    onChange={handleDataChange("upper", item, index)}
                                />
                            </Table.Cell>

                            <Table.Cell>
                                <Button variant="subtle" colorPalette="red" onClick={deleteMetric(index)}>
                                    <MdDeleteForever size={25} />
                                </Button>
                            </Table.Cell>
                        </Table.Row>
                    ))}
                </Table.Body>
            </Table.Root>

            <Flex align={"center"} gap={2}>


            </Flex>

        </Flex>
    )
}
