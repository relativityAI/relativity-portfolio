import { useEffect, useState, useMemo } from "react"
import {
    SimpleGrid,
    Button,
    Flex,
    Text,
    Kbd,
    Image
} from "@chakra-ui/react"

import DataSourceTable from "./DataSourceTable"
import useAutoSave from "@/components/useAutoSave"

import axios from "axios"

import { MdOutlineRemoveCircle } from "react-icons/md"

export default function ProfileDataSources(props) {

    const name = props.name;
    const API_BASE = import.meta.env.VITE_RELATIVITY_API

    const [dataSources, setDataSources] = useState(props.data)
    const [uniqueSources, setUniqueSources] = useState([]);
    const [unSelectedSource, setUnselectedSources] = useState([])
    const [availableMetrics, setAvailableMetrics] = useState({});

    const fetchUniqueSources = () => {

        const url = API_BASE + "/list-data-sources"
        axios.get(url)
            .then(function (response) {
                // const sources = []
                // for (const source of response.data){
                //     sources[source.source] = source.filters
                // }
                setUniqueSources(response.data)
            })
            .catch(function (error) {
                console.log(error);
            });

    }

    const filterUnselectedSources = () => {

        // make sure that only unselected data sources are mentioned on top

        const existingSources = []
        for (const f of dataSources) {
            existingSources.push(f.source)
        }
        const unselectedSources = []
        for (const s of uniqueSources) {
            if (!existingSources.includes(s.source)) {
                unselectedSources.push(s)
            }
        }
        // console.log(unselectedSources)
        setUnselectedSources(unselectedSources)
    }

    const updateDataSources = (index, newDataSource) => {
        let nds = [...dataSources]
        nds[index] = newDataSource
        setDataSources(nds)
    };

    const addNewDataSource = (index, newDataSource) => (e) => {

        let nds = [...dataSources]
        nds[index] = newDataSource
        setDataSources(nds)

    }

    const removeDataSource = (idx) => e => {

        let deletedAt;

        let reducedList = dataSources
            .filter((p, index) => {
                if (index == idx) {
                    deletedAt = index;
                    return false;
                }
                return true;
            })
            .map((item, index) => {
                if (index >= deletedAt) return { ...item, order: item.order - 1 };
                else return item;
            })

        // Update tasks
        setDataSources([...reducedList]);

    }

    const loadAvailableMetrics = async () => {
        let newAvMet = {}

        for (const source of uniqueSources) {
            newAvMet[source.source] = source.filters
        }
        setAvailableMetrics(newAvMet)
    }



    const saveUrl = API_BASE + "/update-profile"
    const data = useMemo(() => ({
        id: props.id,
        data_sources: dataSources
    }), [dataSources]);
    useAutoSave(data, saveUrl);



    useEffect(() => {
        // fetch unique sources as soon as the page loads
        fetchUniqueSources()
    }, [])


    useEffect(() => {
        loadAvailableMetrics()
        filterUnselectedSources()

    }, [uniqueSources])

    useEffect(() => {
        filterUnselectedSources()
    }, [dataSources])

    return (
        <Flex direction={"column"} gap={10}>
            <Flex gap={2} direction={"column"}>
                <Text textStyle={"xl"} fontWeight={"bold"}>
                    Available Data Sources
                </Text>
                <SimpleGrid columns={10} gap={2}>
                    {
                        unSelectedSource ?
                            unSelectedSource.map((item, index) => (


                                    <Flex key={item.source} direction={"column"} gap={1} align={"center"}>
                                        <Image
                                            height="40px"
                                            src={item.image}
                                            onClick={addNewDataSource(dataSources.length, item)}

                                        />
                                        {item.source}
                                    </Flex>

                                //     <Button
                                //         // width={"180px"}
                                //         size="xl"
                                //         key={index}
                                //         size={"xs"}
                                //         variant={"subtle"}
                                //         colorPalette={"blue"}
                                //         onClick={addNewDataSource(dataSources.length, item)}
                                //     >

                                //     </Button>


                            ))

                            :
                            <Text textStyle={"md"}>
                                No more sources Available
                            </Text>
                    }
                </SimpleGrid>
            </Flex>

            <SimpleGrid columns={2} gap="60px">
                {
                    dataSources.map((item, index) => (
                        <div key={index}>
                            <DataSourceTable
                                key={item.source}
                                data={item}
                                index={index}
                                metrics={availableMetrics[item.source] || []}
                                updateDataSources={updateDataSources}
                            />
                            <Flex align={"end"} justify={"space-between"}>

                                {
                                    availableMetrics[item.source] ?

                                        <Text
                                            textStyle={"sm"}
                                            fontWeight={"semibold"}
                                        >
                                            Total configured metrics: <Kbd>{availableMetrics[item.source].length}</Kbd>
                                        </Text>

                                        :
                                        null
                                }

                                <Button
                                    size={"xs"}
                                    variant={"subtle"}
                                    colorPalette={"red"}
                                    onClick={removeDataSource(index)}
                                >
                                    Remove Data Source <MdOutlineRemoveCircle />

                                </Button>
                            </Flex>

                        </div>

                    ))


                }


            </SimpleGrid>

        </Flex>

    )
}
