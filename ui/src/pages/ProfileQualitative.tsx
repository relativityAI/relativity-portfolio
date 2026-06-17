import { useState, useEffect } from "react"
import {
    Flex,
    Textarea,
    Button,
    Input,
    Box,
    Text,
    Slider
} from "@chakra-ui/react"
import { MdDeleteForever } from "react-icons/md";
import DropDown from "@/components/DropDown"

interface ProfileDataQualitativeProps {
    data: any[];
    onUpdate: (data: any[]) => void;
    id: string;
    name: string;
}

export default function ProfileDataQualitative(props: ProfileDataQualitativeProps) {
    const [parameters, setParameters] = useState<any[]>(props.data || []);

    const handleChange = (index: number, field: string, value: any) => {
        const newArr = [...parameters];
        newArr[index] = {
            ...newArr[index],
            [field]: value
        }
        setParameters(newArr);
        props.onUpdate(newArr);
    }

    const addParameter = (e: any) => {
        e.preventDefault();
        const newParams = [...parameters, { 
            parameter: "", 
            content: "", 
            weightage: 5, 
            preferred_source: "Relativity Voyager" 
        }];
        setParameters(newParams);
        props.onUpdate(newParams);
    }

    const deleteParam = (idx: number) => () => {
        const reducedList = parameters.filter((_, index) => index !== idx)
        setParameters(reducedList);
        props.onUpdate(reducedList);
    }

    useEffect(() => {
        setParameters(props.data || [])
    }, [props.data])

    return (
        <Flex direction={"column"} gap={8} width="full">
            {parameters.map((param, index) => (
                <Box 
                    key={index} 
                    p={6} 
                    bg="gray.900" 
                    rounded="sm" 
                    border="1px solid" 
                    borderColor="gray.800"
                    position="relative"
                    _hover={{ borderColor: "gray.700" }}
                    transition="all 0.2s"
                >
                    <Flex direction="column" gap={6}>
                        {/* Header: Title & Delete */}
                        <Flex justify="space-between" align="center">
                            <Flex direction="column" gap={1} flex={1}>
                                <Text fontSize="2xs" fontWeight="black" color="gray.600" letterSpacing="widest">PARAMETER TITLE</Text>
                                <Input 
                                    variant="subtle" 
                                    size="md"
                                    placeholder="e.g. Management Quality"
                                    value={param.parameter} 
                                    onChange={(e) => handleChange(index, "parameter", e.target.value)} 
                                    bg="gray.950"
                                    _focus={{ bg: "gray.950", borderColor: "gray.700" }}
                                    fontWeight="bold"
                                    color="gray.200"
                                    rounded="sm"
                                    border="1px solid"
                                    borderColor="transparent"
                                />
                            </Flex>
                            
                            <Button 
                                size="xs" 
                                variant="ghost" 
                                color="gray.700" 
                                _hover={{ color: "red.500", bg: "transparent" }} 
                                onClick={deleteParam(index)}
                                ml={4}
                            >
                                <MdDeleteForever size={20} />
                            </Button>
                        </Flex>

                        {/* Metadata Rows: Slider & Source (Compact) */}
                        <Flex gap={12} align="center" bg="gray.950/30" px={4} py={3} rounded="sm" border="1px solid" borderColor="gray.800/40">
                            <Flex align="center" gap={4} flex={1}>
                                <Text fontSize="2xs" fontWeight="bold" color="gray.600" letterSpacing="widest" whiteSpace="nowrap">WEIGHTAGE</Text>
                                <Slider.Root 
                                    size="sm" 
                                    defaultValue={[param.weightage || 5]} 
                                    min={0} 
                                    max={10} 
                                    step={1}
                                    onValueChange={(details) => handleChange(index, "weightage", details.value[0])}
                                    width="150px"
                                >
                                    <Slider.Control>
                                        <Slider.Track bg="gray.800">
                                            <Slider.Range bg="blue.600" />
                                        </Slider.Track>
                                        <Slider.Thumb index={0} />
                                    </Slider.Control>
                                </Slider.Root>
                                <Text fontSize="xs" fontWeight="black" color="blue.500" minW="35px">{param.weightage || 5}/10</Text>
                            </Flex>

                            <Flex align="center" gap={4}>
                                <Text fontSize="2xs" fontWeight="bold" color="gray.600" letterSpacing="widest" whiteSpace="nowrap">SOURCE</Text>
                                <DropDown
                                    initValue={param.preferred_source || "Custom Document"}
                                    options={["Web Search", "Relativity Voyager", "Custom Document"]}
                                    onChange={(e: any) => handleChange(index, "preferred_source", e.target.value)}
                                    width="160px"
                                />
                            </Flex>
                        </Flex>

                        {/* Description */}
                        <Flex direction="column" gap={2}>
                            <Text fontSize="2xs" fontWeight="black" color="gray.600" letterSpacing="widest">DESCRIPTION / CONTEXT</Text>
                            <Textarea
                                autoresize
                                minH="4lh"
                                maxH="12lh"
                                variant="subtle"
                                placeholder="Enter detailed qualitative parameters, context, or notes..."
                                value={param.content}
                                size="md"
                                onChange={(e) => handleChange(index, "content", e.target.value)}
                                bg="gray.950"
                                _focus={{ bg: "gray.950", borderColor: "gray.700" }}
                                color="gray.400"
                                lineHeight="relaxed"
                                rounded="sm"
                                border="1px solid"
                                borderColor="transparent"
                            />
                        </Flex>
                    </Flex>
                </Box>
            ))}

            <Button 
                variant="outline" 
                color="gray.500" 
                size="sm" 
                onClick={addParameter} 
                alignSelf="flex-start" 
                fontWeight="bold" 
                borderStyle="dashed"
                borderColor="gray.800"
                _hover={{ color: "white", bg: "gray.900", borderColor: "gray.700" }}
                px={6}
            >
                + ADD PARAMETER
            </Button>
        </Flex>
    )
}
