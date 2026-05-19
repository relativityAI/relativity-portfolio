import { Link,Text, Flex, Button, Separator, Table, Badge } from "@chakra-ui/react";
import axios from "axios";
import { useEffect, useState } from "react";
import {  useNavigate } from "react-router-dom";
import { MdDeleteForever } from "react-icons/md";

export default function AnalysisList() {
    let navigate = useNavigate();
    const API_BASE = import.meta.env.VITE_RELATIVITY_API


    const [uniqueAnalysis, setUniqueAnalysis] = useState([]);

    const variant = "outline"

    const fetchUniqueAnalysis = () => {
        const url = API_BASE + "/list-analysis"
        axios.get(url)
            .then(function (response) {
                setUniqueAnalysis(response.data)

            })
            .catch(function (error) {
                console.log(error);
            });

    }

    useEffect(() => {
        fetchUniqueAnalysis()
    }, [])

    return (
        <Flex direction={"column"} gap={2}>

            <Flex>

                <Text
                    fontWeight="semibold" textStyle="5xl"
                >
                    Share Analysis
                </Text>
            </Flex>

            <Table.Root key={variant} size="sm" variant={variant}>
                <Table.Header>
                    <Table.Row>
                        <Table.ColumnHeader>ID</Table.ColumnHeader>
                        <Table.ColumnHeader>Name</Table.ColumnHeader>
                        <Table.ColumnHeader>Created At</Table.ColumnHeader>
                        <Table.ColumnHeader>Link</Table.ColumnHeader>
                        <Table.ColumnHeader>Status</Table.ColumnHeader>
                        <Table.ColumnHeader></Table.ColumnHeader>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {uniqueAnalysis.map((item) => (
                        <Table.Row key={item._id}>
                            <Table.Cell>{item._id}</Table.Cell>
                            <Table.Cell>{item.name}</Table.Cell>
                            <Table.Cell>{new Date(item.created_at).toLocaleString()}</Table.Cell>
                            <Table.Cell>
                                <Link variant="underline" href={"/analysis/" + item._id}>Go to Analysis ↗</Link>
                            </Table.Cell>
                            <Table.Cell>
                                <Badge colorPalette={"yellow"}>PENDING</Badge>
                            </Table.Cell>
                            <Table.Cell>
                                <MdDeleteForever
                                    onClick={async () => {
                                        await axios.get(
                                            API_BASE + "/delete-analysis?id=" + item._id,
                                        )
                                            .then((response) => {
                                                // console.log("Deleted "+ item.name)
                                                window.location.reload();

                                            })
                                            .catch((error) => {
                                                console.log(error)
                                            })
                                    }}
                                    color="red"
                                    size={25} />


                            </Table.Cell>

                        </Table.Row>
                    ))}
                </Table.Body>
            </Table.Root>


            <Button
                variant={"surface"}
                onClick={async () => {

                    await axios.get(API_BASE + "/create-analysis")
                        .then((response) => {
                            let data = response.data
                            navigate("/analysis/" + data.id)
                        })
                        .catch((error) => {
                            console.log(error)
                        })
                }}
            >
                + New Analysis
            </Button>

        </Flex >



    )

}
