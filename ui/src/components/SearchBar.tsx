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
import { useEffect, useState, useMemo } from "react"
import { useAsync } from "react-use"


export default function SearchBar(props) {
    const [inputValue, setInputValue] = useState("")
    const [items, setItems] = useState([])
    const [value, setValue] = useState<string[]>([])

    const mainKey = props.mainKey || "SYMBOL"
    const secondaryKey = props.secondaryKey || "NAME"
    const searchParams = props.params || {}

    const collection = useMemo(() => createListCollection({
        items: items,
        itemToString: (item) => (item ? item[mainKey] : ""),
        itemToValue: (item) => (item ? item[mainKey] : ""),
    }), [items, mainKey])

    const state = useAsync(async () => {
        const params = new URLSearchParams({ query: inputValue })
        Object.entries(searchParams).forEach(([key, val]) => {
            if (val) params.set(key, val as string)
        })
        const response = await fetch(`${props.url}?${params}`)
        const data = await response.json()
        setItems(Array.isArray(data) ? data : [])
    }, [inputValue, props.url, JSON.stringify(searchParams)])

    useEffect(() => {
        const selectedItem = items.find(i => i[mainKey] === value[0]);
        if (value[0] !== undefined) {
             props.onChange(props.field, value[0], selectedItem)
        }
    }, [value, items, mainKey, props.field, props.onChange])



    return (
        <Combobox.Root
            collection={collection}
            placeholder={props.placeholder || "Type to search"}
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
                        ) : items.length === 0 && inputValue.length > 0 ? (
                            <Span p="2" color="fg.muted">
                                No results found
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

