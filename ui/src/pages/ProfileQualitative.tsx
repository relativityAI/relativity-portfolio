import { useState, useMemo, useEffect } from "react"
import {
    Flex,
    Textarea,
    Button,
    Table,
    Input,
    Badge
} from "@chakra-ui/react"

// import axios from "axios";

import useAutoSave from "@/components/useAutoSave";


import { MdOutlineFileDownload, MdDeleteForever } from "react-icons/md";
import { FaMagic } from "react-icons/fa";


export default function ProfileDataQualitative(props) {


    const name = props.name;
  

    const variant = "line"

    const [parameters, setParameters] = useState([]);
    // console.log(parameters)
    // const [savedStatus, setSavedStatus] = useState("Saved")

    const API_BASE = import.meta.env.VITE_RELATIVITY_API
    const saveUrl = API_BASE + "/update-profile"
    const data = useMemo(() => ({
        id: props.id,
        qualitative: parameters
    }), [ parameters]);
    useAutoSave(data, saveUrl);


    const handleParamNameChange = (index) => e => {

        let newArr = [...parameters];
        newArr[index] = {
            parameter: e.target.value,
            content: parameters[index].content
        }
        setParameters(newArr);
    }

    const handleContentChange = (index) => e => {

        let newArr = [...parameters];
        newArr[index] = {
            parameter: parameters[index].parameter,
            content: e.target.value
        }
        setParameters(newArr);
    }

    const addParameter = (e) => {
        e.preventDefault();

        let newParams = [...parameters];
        newParams[newParams.length] = {
            parameter: "",
            content: ""
        }
        setParameters(newParams);
    }

    const deleteParam = (idx) => e => {

        let deletedAt;

        let reducedList = parameters
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
        setParameters([...reducedList]);

    }

    useEffect(()=>{
        setParameters(props.data)
    },[])

    return (
        <Flex direction={"column"} gap={2}>
            <Table.Root key={variant} size="sm" variant={variant}>
                <Table.Header>
                    <Table.Row>
                        <Table.ColumnHeader width="1/4">Param</Table.ColumnHeader>
                        <Table.ColumnHeader width="1/7">Weightage</Table.ColumnHeader>
                        <Table.ColumnHeader width="1/2">
                            <Flex gap={1}>
                                Content
                                <Badge colorPalette="purple">
                                    Autosaving enabled
                                    <FaMagic />
                                </Badge>
                            </Flex>
                        </Table.ColumnHeader>
                        <Table.ColumnHeader width="1/6">Tools</Table.ColumnHeader>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {Object.keys(parameters).map((item, index) => (
                        <Table.Row key={item}>
                            <Table.Cell>
                                <Flex align={"center"} gap={1}>
                                    <Input variant="subtle" maxW="10lh" value={parameters[item].parameter} onChange={handleParamNameChange(index)} />
                                    <Button variant="subtle" colorPalette="red" onClick={deleteParam(index)}>
                                        Delete <MdDeleteForever onClick={deleteParam(index)} size={25} />
                                    </Button>
                                </Flex>

                            </Table.Cell>
                            <Table.Cell></Table.Cell>

                            <Table.Cell>
                                <Textarea
                                    autoresize
                                    minH="5lh"
                                    maxH="10lh"
                                    value={parameters[item].content}
                                    size="sm"
                                    onChange={handleContentChange(index)}
                                />
                            </Table.Cell>

                            <Table.Cell></Table.Cell>


                        </Table.Row>
                    ))}
                </Table.Body>
            </Table.Root>

            <Button colorPalette="gray" variant={"surface"} onClick={addParameter} >+ Add another parameter</Button>


        </Flex>
    )

}
