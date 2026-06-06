import { useEffect, useState } from "react";
import { Button, Flex, Menu, Portal, Text } from "@chakra-ui/react"
import { Link } from "react-router-dom";
import { runHealthCheck } from "../utils"
import { MdCheckCircle, MdError } from "react-icons/md";
import { FaUser } from "react-icons/fa";


export default function NavBar() {

    const [systemStatus, setSystemStatus] = useState({
        api: 0,
        db: 0,
        voyagerApi: 0,
        nebulaApi: 0,
    })

    const [endpoints, setEndpoints] = useState({
        api: "",
        db: "",
        voyagerApi: "",
        nebulaApi: ""
    })

    useEffect(() => {
        const fetchData = async () => {
            const { data, endpoints } = await runHealthCheck();
            setSystemStatus(data)
            setEndpoints(endpoints)
        };

        fetchData();
    }, []);

    return (
        <Flex padding={4} margin={0} justify={"space-between"} align={"center"}>


            <Menu.Root >
                <Menu.Trigger asChild>
                    <Button colorPalette={"blue"} variant="surface" size="sm">
                        Menu
                    </Button>
                </Menu.Trigger>
                <Portal>
                    <Menu.Positioner>
                        <Menu.Content>
                            <Menu.Item value="//"><Link to={"/"}>Dashboard</Link></Menu.Item>
                            <Menu.Item value="/profiles"><Link to={"/profiles"}>Profiles</Link></Menu.Item>
                            <Menu.Item value="/analysis-list"><Link to={"/analysis-list"}>Analysis</Link></Menu.Item>
                        </Menu.Content>
                    </Menu.Positioner>
                </Portal>
            </Menu.Root>

            <Text fontWeight={"medium"} textStyle={"3xl"}>Relativity AI Portfolio</Text>

            <Flex justify={"space-between"} gap={10}>


                    <Flex gap={2} align={"center"}>
                        <Text 
                            textStyle={"xs"} 
                            fontWeight={"bold"} 
                            color={systemStatus.db ? "gray.500" : "red.500"} 
                            cursor={"pointer"}
                            _hover={{ color: "blue.500" }}
                            onClick={() => window.open(endpoints.db, "_blank")}
                        >
                            MONGODB
                        </Text>
                        <Text textStyle={"xs"}>DB</Text>
                        {systemStatus.db ? <MdCheckCircle color="green" /> : <MdError color="red" />}
                    </Flex>

                    <Flex gap={2} align={"center"}>
                        <Text 
                            textStyle={"xs"} 
                            fontWeight={"bold"} 
                            color={systemStatus.voyagerApi ? "gray.500" : "red.500"} 
                            cursor={"pointer"}
                            _hover={{ color: "blue.500" }}
                            onClick={() => window.open(endpoints.voyagerApi, "_blank")}
                        >
                            VOYAGER
                        </Text>
                        <Text textStyle={"xs"}>API</Text>
                        {systemStatus.voyagerApi ? <MdCheckCircle color="green" /> : <MdError color="red" />}
                    </Flex>

                    <Flex gap={2} align={"center"}>
                        <Text 
                            textStyle={"xs"} 
                            fontWeight={"bold"} 
                            color={systemStatus.nebulaApi ? "gray.500" : "red.500"} 
                            cursor={"pointer"}
                            _hover={{ color: "blue.500" }}
                            onClick={() => window.open(endpoints.nebulaApi, "_blank")}
                        >
                            NEBULA
                        </Text>
                        <Text textStyle={"xs"}>API</Text>
                        {systemStatus.nebulaApi ? <MdCheckCircle color="green" /> : <MdError color="red" />}
                    </Flex>

                <FaUser />

            </Flex>


        </Flex>


    )
}