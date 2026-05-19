import { useEffect, useState, useMemo } from "react"

import axios from "axios"
import {
    Table,
    Flex,
    Badge,
    Input,
    Textarea,
    Button,
    Text,
    Image,


} from "@chakra-ui/react";

import { MdOutlineFileDownload, MdDeleteForever } from "react-icons/md";
import useAutoSave from "@/components/useAutoSave";
import { LuChartNoAxesColumnIncreasing } from "react-icons/lu";


export default function DataSources() {

    const API_BASE = import.meta.env.VITE_RELATIVITY_API
    const [uniqueSources, setUniqueSources] = useState([]);
    const [availableMetrics, setAvailableMetrics] = useState({});


    const fetchUniqueSources = () => {
        const url = API_BASE + "/list-data-sources"
        axios.get(url)
            .then(function (response) {
                setUniqueSources(response.data)

            })
            .catch(function (error) {
                console.log(error);
            });

    }

    useEffect(() => {
        // console.log(dataSources)
        fetchUniqueSources()
    }, [])


    const addMetric = (sourceIdx) => (e) => {

        let newUniqueSources = [...uniqueSources]
        newUniqueSources[sourceIdx].filters[newUniqueSources[sourceIdx].filters.length] = {
            "metric": "",
            "direction": "",
            "threshold": "",
            "lower": "",
            "upper": "",

        }
        setUniqueSources(newUniqueSources)
    }

    const deleteMetric = (sourceIdx, metricIdx) => (e) => {
        let deletedAt;
        let reducedList = uniqueSources[sourceIdx].filters.filter((metric, idx) => {
            if (idx == metricIdx) {
                deletedAt = metricIdx;
                return false;
            }
            return true;
        }).map((item, idx) => {
            if (idx >= deletedAt) return { ...item, order: item.order - 1 };
            else return item;
        })

        let newUniqueSources = [...uniqueSources]
        newUniqueSources[sourceIdx].filters = reducedList

        setUniqueSources(newUniqueSources)


    }

    const addSource = () => {

        let newUniqueSources = [...uniqueSources]

        const newSource = {
            source: "new-source",
            image: "new-image",
            filters: [
                {
                    "metric": "",
                    "direction": "",
                    "threshold": "",
                    "lower": "",
                    "upper": "",
                }
            ]
        }
        newUniqueSources[newUniqueSources.length] = newSource

            axios.post(
                API_BASE + "/create-data-source",
                newSource
            )
                .then((response) => {
                    console.log(response)
                    console.log("Created new source: " + newSource.source)
                })
                .catch((error) => {
                    console.log(error)
                })

        setUniqueSources(newUniqueSources)

    }

    const deleteSource = (sourceIdx) => (e) => {

        let deletedAt;
        let reducedList = uniqueSources.filter((source, idx) => {
            if (idx == sourceIdx) {
                deletedAt = sourceIdx;

                axios.post(
                    API_BASE + "/delete-data-source",
                    source
                )
                    .then((response) => {
                        console.log(response)
                        console.log("Deleted source: " + source.source)
                    })
                    .catch((error) => {
                        console.log(error)
                    })

                return false;
            }
            return true;
        }).map((item, idx) => {
            if (idx >= deletedAt) return { ...item, order: item.order - 1 };
            else return item;
        })

        let newUniqueSources = [...uniqueSources]
        newUniqueSources = reducedList
        setUniqueSources(newUniqueSources)

    }

    const handleImageChange = (sourceIdx) => (e) => {
        let newUniqueSources = [...uniqueSources]
        newUniqueSources[sourceIdx] = {
            ...newUniqueSources[sourceIdx],
            image: e.target.value
        }
        setUniqueSources(newUniqueSources)
    }

    const handleNameChange = (sourceIdx) => (e) => {
        let newUniqueSources = [...uniqueSources]
        newUniqueSources[sourceIdx] = {
            ...newUniqueSources[sourceIdx],
            source: e.target.value
        }
        setUniqueSources(newUniqueSources)
    }

    const handleMetricChange = (sourceIdx, metricIdx, field) => (e) => {

        // console.log("should change " + uniqueSources[sourceIdx].filters[metricIdx].metric )

        let newUniqueSources = [...uniqueSources]
        newUniqueSources[sourceIdx].filters[metricIdx] = {
            ...newUniqueSources[sourceIdx].filters[metricIdx],
            [field]: e.target.value
        }

        setUniqueSources(newUniqueSources)

    }

    const saveUrl = API_BASE + "/update-data-sources"
    useAutoSave(uniqueSources, saveUrl)

    // Manage data sources
    return (
        <Flex gap={2} direction={'column'}>
            <Text
                fontWeight="semibold" textStyle="5xl"
            >
                Manage Data Sources
            </Text>
            <Table.Root key="line" size="sm" variant="line">
                <Table.Header>
                    <Table.Row>
                        <Table.ColumnHeader width="1/4">Source</Table.ColumnHeader>
                        <Table.ColumnHeader width="1/4">Logo URL</Table.ColumnHeader>
                        <Table.ColumnHeader width="1/2">
                            <Flex gap={1}>
                                Unique metrics available (comma seperated)
                                <Badge colorPalette="purple">
                                    Autosaving enabled
                                </Badge>
                            </Flex>
                        </Table.ColumnHeader>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {uniqueSources.map((sourceItem, sourceIdx) => (
                        <Table.Row key={sourceIdx}>
                            <Table.Cell>
                                <Flex align={"center"} gap={1}>
                                    <Input
                                        variant="subtle"
                                        maxW="10lh"
                                        value={sourceItem.source}
                                        onChange={handleNameChange(sourceIdx)}
                                    />

                                    <Button
                                        variant="subtle"
                                        colorPalette="red"
                                        onClick={deleteSource(sourceIdx)}
                                    >
                                        <MdDeleteForever
                                            // onClick={deleteParam(index)} 
                                            size={25} />
                                    </Button>
                                </Flex>

                            </Table.Cell>
                            <Table.Cell>
                                <Flex gap={2}>
                                    <Image src={sourceItem.image} height={"40px"} />
                                    <Input
                                        value={sourceItem.image}
                                        onChange={handleImageChange(sourceIdx)}
                                    />
                                </Flex>
                            </Table.Cell>

                            <Table.Cell>
                                <Flex direction={"column"} gap={2}>
                                    <Table.Root variant={'outline'} size="sm">
                                        <Table.Header>
                                            <Table.Row>
                                                <Table.ColumnHeader>Metric</Table.ColumnHeader>
                                                <Table.ColumnHeader>Direction</Table.ColumnHeader>
                                                <Table.ColumnHeader textAlign="end">Default Threshold</Table.ColumnHeader>
                                                <Table.ColumnHeader textAlign="end">Default Lower</Table.ColumnHeader>
                                                <Table.ColumnHeader textAlign="end">Default Upper</Table.ColumnHeader>
                                                <Table.ColumnHeader textAlign="end"></Table.ColumnHeader>
                                            </Table.Row>
                                        </Table.Header>
                                        <Table.Body>
                                            {sourceItem.filters.map((metricItem, metricIdx) => (
                                                <Table.Row key={metricIdx}>
                                                    <Table.Cell>
                                                        <Input variant={"flushed"}
                                                            value={metricItem.metric}
                                                            onChange={handleMetricChange(sourceIdx, metricIdx, "metric")}

                                                        />
                                                    </Table.Cell>
                                                    <Table.Cell>
                                                        <Input
                                                            variant={"flushed"}
                                                            onChange={handleMetricChange(sourceIdx, metricIdx, "direction")}
                                                            value={metricItem.direction} />
                                                    </Table.Cell>
                                                    <Table.Cell>
                                                        <Input
                                                            onChange={handleMetricChange(sourceIdx, metricIdx, "threshold")}

                                                            variant={"flushed"} value={metricItem.threshold} />
                                                    </Table.Cell>
                                                    <Table.Cell textAlign="end">
                                                        <Input
                                                            onChange={handleMetricChange(sourceIdx, metricIdx, "lower")}

                                                            variant={"flushed"} value={metricItem.lower} />
                                                    </Table.Cell>
                                                    <Table.Cell textAlign="end">
                                                        <Input variant={"flushed"}
                                                            onChange={handleMetricChange(sourceIdx, metricIdx, "upper")}

                                                            value={metricItem.upper} />
                                                    </Table.Cell>
                                                    <Table.Cell>
                                                        <Button
                                                            variant="subtle"
                                                            colorPalette="red"
                                                            onClick={deleteMetric(sourceIdx, metricIdx)}
                                                        >
                                                            <MdDeleteForever
                                                                // onClick={deleteParam(index)} 
                                                                size={25} />
                                                        </Button>
                                                    </Table.Cell>

                                                </Table.Row>
                                            ))}
                                        </Table.Body>

                                    </Table.Root>

                                    <Button colorPalette="green" variant={"subtle"} onClick={addMetric(sourceIdx)} >+ Add another metric</Button>
                                </Flex>
                            </Table.Cell>

                            {/* <Table.Cell></Table.Cell> */}


                        </Table.Row>

                    ))}

                </Table.Body>
            </Table.Root>
            <Button colorPalette="gray" variant={"surface"} onClick={addSource} >+ Add another source</Button>


        </Flex>



    )

}