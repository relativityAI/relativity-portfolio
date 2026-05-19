import {
    Flex,
    Button,
    Table
} from "@chakra-ui/react"
import { Link, Text } from "@chakra-ui/react"
import axios from "axios"
import { useState, useEffect } from "react";
import { MdDeleteForever } from "react-icons/md";
import { useNavigate } from "react-router-dom";


export default function ProfilesList(props) {
    let navigate = useNavigate();

    const variant = "outline"
    const [uniqueProfiles, setUniqueProfiles] = useState([]);

    const API_BASE = import.meta.env.VITE_RELATIVITY_API


    const fetchUniqueProfiles = () => {
        const url = API_BASE + "/list-profiles"
        axios.get(url)
            .then(function (response) {
                setUniqueProfiles(response.data)

            })
            .catch(function (error) {
                console.log(error);
            });

    }

    useEffect(() => {
        fetchUniqueProfiles()
    }, [])


    return (
        <Flex direction={"column"} gap={3}>
            <Flex>

                <Text
                    fontWeight="semibold" textStyle="5xl"
                >
                    Investor Profiles
                </Text>
            </Flex>

            <Table.Root key={variant} size="sm" variant={variant}>
                <Table.Header>
                    <Table.Row>
                        <Table.ColumnHeader>ID</Table.ColumnHeader>
                        <Table.ColumnHeader>Name</Table.ColumnHeader>
                        <Table.ColumnHeader>Created At</Table.ColumnHeader>
                        <Table.ColumnHeader>Link</Table.ColumnHeader>
                        <Table.ColumnHeader></Table.ColumnHeader>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {uniqueProfiles.map((item) => (
                        <Table.Row key={item._id}>
                            <Table.Cell>{item._id}</Table.Cell>
                            <Table.Cell>{item.name}</Table.Cell>
                            <Table.Cell>{new Date(item.created_at).toLocaleString()}</Table.Cell>
                            <Table.Cell>
                                <Link variant="underline" href={"/profile/" + item._id}>Go to profile ↗</Link>
                            </Table.Cell>
                            <Table.Cell>
                                <MdDeleteForever
                                    onClick={async () => {
                                        await axios.post(
                                            API_BASE + "/delete-profile",
                                            { id: item._id }
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

                    await axios.get(API_BASE + "/create-profile")
                        .then((response) => {
                            const data = response.data
                            navigate("/profile/" + data.id)
                        })
                }
                }>
                + New Analysis
            </Button>


        </Flex>
    )


}