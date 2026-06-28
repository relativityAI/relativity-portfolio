import { useState, useEffect } from "react"
import {
    Flex,
    Textarea,
    Button,
    Input,
    Box,
    Text,
    IconButton,
} from "@chakra-ui/react"
import { MdDeleteForever, MdAdd, MdRemove } from "react-icons/md";

interface ProfileDataQualitativeProps {
    data: any[];
    onUpdate: (data: any[]) => void;
    id: string;
    name: string;
    metrics?: any;
}

export default function ProfileDataQualitative(props: ProfileDataQualitativeProps) {
    const [parameters, setParameters] = useState<any[]>(props.data || []);

    const handleChange = (index: number, field: string, value: any) => {
        const newArr = [...parameters];
        newArr[index] = { ...newArr[index], [field]: value };
        setParameters(newArr);
        props.onUpdate(newArr);
    }

    const addParameter = (e: any) => {
        e.preventDefault();
        const newParams = [...parameters, { parameter: "", content: "", weightage: 5 }];
        setParameters(newParams);
        props.onUpdate(newParams);
    }

    const deleteParam = (idx: number) => () => {
        const reducedList = parameters.filter((_, index) => index !== idx);
        setParameters(reducedList);
        props.onUpdate(reducedList);
    }

    useEffect(() => {
        setParameters(props.data || [])
    }, [props.data])

    return (
        <Flex direction="column" gap={0} width="full">
            {/* Header row */}
            <Flex
                gap={3}
                px={3}
                py={2}
                bg="bg.muted"
                borderTopRadius="sm"
                border="1px solid"
                borderColor="border"
                borderBottom="none"
                fontSize="2xs"
                fontWeight="bold"
                color="fg.muted"
                letterSpacing="widest"
            >
                <Box flex={1.5}>PARAMETER</Box>
                <Box width="52px" textAlign="center" flexShrink={0}>WGT</Box>
                <Box flex={3}>DESCRIPTION / CONTEXT</Box>
                <Box width="32px" flexShrink={0} />
            </Flex>

            {parameters.length === 0 ? (
                <Flex
                    direction="column"
                    align="center"
                    gap={2}
                    py={8}
                    border="1px solid"
                    borderColor="border"
                    borderTop="none"
                    borderBottomRadius="sm"
                >
                    <Text fontSize="sm" color="fg.muted">No qualitative parameters yet</Text>
                    <Text fontSize="xs" color="fg.muted">Add parameters like management quality, brand strength, etc.</Text>
                </Flex>
            ) : (
                parameters.map((param, index) => {
                    const isLast = index === parameters.length - 1;
                    return (
                        <Flex
                            key={index}
                            gap={3}
                            px={3}
                            py={2.5}
                            align="flex-start"
                            border="1px solid"
                            borderColor="border"
                            borderTop="none"
                            borderBottomRadius={isLast ? "sm" : "none"}
                            bg={index % 2 === 0 ? "bg.subtle/30" : "transparent"}
                            _hover={{ bg: "bg.muted/50" }}
                            transition="background 0.15s"
                        >
                            <Box flex={1.5}>
                                <Input
                                    variant="subtle"
                                    size="2xs"
                                    placeholder="e.g. Management Quality"
                                    value={param.parameter}
                                    onChange={(e) => handleChange(index, "parameter", e.target.value)}
                                    bg="bg.subtle"
                                    border="1px solid"
                                    borderColor="border.emphasized"
                                    _focus={{ borderColor: "fg.muted" }}
                                    color="fg"
                                    rounded="sm"
                                    fontSize="xs"
                                    minH="28px"
                                    px={2}
                                />
                            </Box>
                            <Box width="52px" flexShrink={0} textAlign="center">
                                <Flex align="center" justify="center" gap={0}>
                                    <IconButton
                                        size="2xs"
                                        variant="ghost"
                                        color="fg.muted"
                                        _hover={{ color: "fg" }}
                                        onClick={() => handleChange(index, "weightage", Math.max(1, (param.weightage ?? 5) - 1))}
                                        minW="16px"
                                        h="22px"
                                        p={0}
                                    >
                                        <MdRemove size={10} />
                                    </IconButton>
                                    <Text
                                        fontSize="xs"
                                        fontWeight="bold"
                                        color="fg"
                                        minW="16px"
                                        textAlign="center"
                                        userSelect="none"
                                    >
                                        {param.weightage ?? 5}
                                    </Text>
                                    <IconButton
                                        size="2xs"
                                        variant="ghost"
                                        color="fg.muted"
                                        _hover={{ color: "fg" }}
                                        onClick={() => handleChange(index, "weightage", Math.min(10, (param.weightage ?? 5) + 1))}
                                        minW="16px"
                                        h="22px"
                                        p={0}
                                    >
                                        <MdAdd size={10} />
                                    </IconButton>
                                </Flex>
                            </Box>
                            <Box flex={3}>
                                <Textarea
                                    autoresize
                                    variant="subtle"
                                    size="2xs"
                                    minH="28px"
                                    maxH="6lh"
                                    placeholder="Describe the parameter or add context..."
                                    value={param.content}
                                    onChange={(e) => handleChange(index, "content", e.target.value)}
                                    bg="bg.subtle"
                                    border="1px solid"
                                    borderColor="border.emphasized"
                                    _focus={{ borderColor: "fg.muted" }}
                                    color="fg.muted"
                                    rounded="sm"
                                    fontSize="xs"
                                    px={2}
                                    py={1}
                                    lineHeight="short"
                                />
                            </Box>
                            <Box width="32px" flexShrink={0}>
                                <Button
                                    size="xs"
                                    variant="ghost"
                                    color="fg.muted"
                                    _hover={{ color: "red.500", bg: "transparent" }}
                                    onClick={deleteParam(index)}
                                    minW="auto"
                                    h="auto"
                                    p={1}
                                >
                                    <MdDeleteForever size={16} />
                                </Button>
                            </Box>
                        </Flex>
                    );
                })
            )}

            <Button
                variant="outline"
                color="fg.subtle"
                size="sm"
                onClick={addParameter}
                alignSelf="flex-start"
                mt={3}
                fontWeight="bold"
                borderStyle="dashed"
                borderColor="border"
                _hover={{ color: "fg", bg: "bg.muted", borderColor: "border.emphasized" }}
                px={5}
            >
                <MdAdd />
                ADD PARAMETER
            </Button>
        </Flex>
    )
}