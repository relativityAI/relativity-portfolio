import { useState, useEffect } from "react"
import {
    Flex,
    Textarea,
    Button,
    Table,
    Input
} from "@chakra-ui/react"
import { MdDeleteForever } from "react-icons/md";

interface ProfileDataQualitativeProps {
    data: any[];
    onUpdate: (data: any[]) => void;
    id: string;
    name: string;
}

export default function ProfileDataQualitative(props: ProfileDataQualitativeProps) {
    const [parameters, setParameters] = useState<any[]>(props.data || []);
    const variant = "line"

    const handleParamNameChange = (index: number) => (e: any) => {
        const newArr = [...parameters];
        newArr[index] = {
            ...newArr[index],
            parameter: e.target.value
        }
        setParameters(newArr);
        props.onUpdate(newArr);
    }

    const handleContentChange = (index: number) => (e: any) => {
        const newArr = [...parameters];
        newArr[index] = {
            ...newArr[index],
            content: e.target.value
        }
        setParameters(newArr);
        props.onUpdate(newArr);
    }

    const addParameter = (e: any) => {
        e.preventDefault();
        const newParams = [...parameters, { parameter: "", content: "" }];
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
        <Flex direction={"column"} gap={4}>
            <Table.Root key={variant} size="sm" variant={variant}>
                <Table.Header>
                    <Table.Row>
                        <Table.ColumnHeader width="1/4">Parameter</Table.ColumnHeader>
                        <Table.ColumnHeader width="1/2">Content</Table.ColumnHeader>
                        <Table.ColumnHeader width="1/6"></Table.ColumnHeader>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {parameters.map((param, index) => (
                        <Table.Row key={index}>
                            <Table.Cell verticalAlign="top">
                                <Input 
                                    variant="subtle" 
                                    size="sm"
                                    placeholder="e.g. Management"
                                    value={param.parameter} 
                                    onChange={handleParamNameChange(index)} 
                                />
                            </Table.Cell>

                            <Table.Cell verticalAlign="top">
                                <Textarea
                                    autoresize
                                    minH="4lh"
                                    maxH="10lh"
                                    placeholder="Enter description..."
                                    value={param.content}
                                    size="sm"
                                    onChange={handleContentChange(index)}
                                />
                            </Table.Cell>

                            <Table.Cell verticalAlign="top">
                                <Button size="xs" variant="ghost" colorPalette="red" onClick={deleteParam(index)}>
                                    <MdDeleteForever size={20} />
                                </Button>
                            </Table.Cell>
                        </Table.Row>
                    ))}
                </Table.Body>
            </Table.Root>

            <Button colorPalette="blue" variant={"outline"} size="sm" onClick={addParameter} alignSelf="flex-start">
                + Add Parameter
            </Button>
        </Flex>
    )
}
