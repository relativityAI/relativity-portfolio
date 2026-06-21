import { useEffect, useState } from "react";
import { Flex, Text } from "@chakra-ui/react"
import { Link } from "react-router-dom";
import { runHealthCheck } from "../utils"
import { MdCheckCircle, MdError } from "react-icons/md";


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
        <Flex 
            paddingX={8} 
            paddingY={2} 
            borderBottom="1px solid" 
            borderColor="gray.800" 
            justify={"space-between"} 
            align={"center"}
            bg="black"
            height="56px"
        >
            <Flex align="center" gap={8}>
                <Text fontWeight={"bold"} fontSize="xl" letterSpacing="tight">RELATIVITY</Text>
                
                <Flex gap={6} align="center">
                    <Link to={"/"}>
                        <Text fontSize="sm" fontWeight="medium" color="gray.400" _hover={{ color: "white" }}>Dashboard</Text>
                    </Link>
                    <Link to={"/profiles"}>
                        <Text fontSize="sm" fontWeight="medium" color="gray.400" _hover={{ color: "white" }}>Profiles</Text>
                    </Link>
                    <Link to={"/analysis-list"}>
                        <Text fontSize="sm" fontWeight="medium" color="gray.400" _hover={{ color: "white" }}>Analysis</Text>
                    </Link>
                    <Link to={"/manage-data"}>
                        <Text fontSize="sm" fontWeight="medium" color="gray.400" _hover={{ color: "white" }}>Data</Text>
                    </Link>
                </Flex>
            </Flex>

            <Flex justify={"flex-end"} gap={6} align="center">
                <Flex gap={4} align={"center"}>
                    <Flex gap={1} align={"center"}>
                        <Text 
                            textStyle={"xs"} 
                            fontWeight={"bold"} 
                            color={systemStatus.db ? "gray.500" : "red.500"} 
                            cursor={"pointer"}
                            _hover={{ color: "blue.500" }}
                            onClick={() => window.open(endpoints.db, "_blank")}
                        >
                            DB
                        </Text>
                        {systemStatus.db ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                    </Flex>

                    <Flex gap={1} align={"center"}>
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
                        {systemStatus.voyagerApi ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                    </Flex>

                    <Flex gap={1} align={"center"}>
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
                        {systemStatus.nebulaApi ? <MdCheckCircle size={12} color="green" /> : <MdError size={12} color="red" />}
                    </Flex>
                </Flex>
            </Flex>
        </Flex>
    )
}