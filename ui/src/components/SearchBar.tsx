"use client"

import {
    Combobox,
    createListCollection,
    HStack,
    Portal,
    Span,
    Spinner,
    useListCollection,
} from "@chakra-ui/react"
import { useEffect, useState } from "react"
import { useAsync } from "react-use"


export default function SearchBar(props) {
    const [inputValue, setInputValue] = useState("")
    const [items, setItems] = useState([])
    const [value, setValue] = useState<string[]>([])


    const mainKey = props.mainKey || "SYMBOL"
    const secondaryKey = props.secondaryKey || "NAME"

    const collection = createListCollection({
        items: items,
        itemToString: (item) => item[mainKey],
        itemToValue: (item) => item[mainKey],
    })

    const state = useAsync(async () => {
        const response = await fetch(
            // `https://swapi.py4e.com/api/people/?search=${inputValue}`,
            `${props.url}/?query=${inputValue}`,
        )
        const data = await response.json()
        setItems(Array.isArray(data) ? data : [])


    }, [inputValue])

    useEffect(()=>{
        props.onChange(props.field, value[0])
    }, [value])
    


    return (
        <Combobox.Root
            // width="320px"
            collection={collection}
            placeholder="Example: C-3PO"
            onInputValueChange={(e) => setInputValue(e.inputValue)}
            variant={"subtle"}
            value={value}
            onValueChange={(e) => setValue(e.value)}
            positioning={{ sameWidth: false, placement: "bottom-start" }}
        >
            {
                props.label ?
                    <Combobox.Label>{props.label}</Combobox.Label>
                    :
                    null
            }


            <Combobox.Control>
                <Combobox.Input placeholder="Type to search" />
                <Combobox.IndicatorGroup>
                    <Combobox.ClearTrigger />
                    <Combobox.Trigger />
                </Combobox.IndicatorGroup>
            </Combobox.Control>

            <Portal>
                <Combobox.Positioner>
                    <Combobox.Content minW="sm">
                        {state.loading ? (
                            <HStack p="2">
                                <Spinner size="xs" borderWidth="1px" />
                                <Span>Loading...</Span>
                            </HStack>
                        ) : state.error ? (
                            <Span p="2" color="fg.error">
                                Error fetching
                            </Span>
                        ) : (
                            collection.items?.map((character) => (
                                <Combobox.Item
                                    key={character[mainKey]}
                                    item={character}
                                >
                                    <HStack justify="space-between" textStyle="sm">
                                        <Span fontWeight="medium" truncate>
                                            {character[mainKey]}
                                        </Span>
                                        <Span color="fg.muted" truncate>
                                            {character[secondaryKey]}
                                        </Span>
                                    </HStack>
                                    <Combobox.ItemIndicator />
                                </Combobox.Item>
                            ))
                        )}
                    </Combobox.Content>
                </Combobox.Positioner>
            </Portal>
        </Combobox.Root>
    )
}

