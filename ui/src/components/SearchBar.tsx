"use client"

import {
    Combobox,
    createListCollection,
    HStack,
    Portal,
    Span,
    Spinner,
} from "@chakra-ui/react"
import { useEffect, useState, useMemo, useRef } from "react"

export default function SearchBar(props) {
    const [inputValue, setInputValue] = useState("")
    const [items, setItems] = useState([])
    const [value, setValue] = useState<string[]>([])
    const [loading, setLoading] = useState(false)
    const debounceRef = useRef<ReturnType<typeof setTimeout>>()
    const abortRef = useRef<AbortController>()

    const mainKey = props.mainKey || "SYMBOL"
    const secondaryKey = props.secondaryKey || "NAME"
    const searchParams = props.params || {}

    const collection = useMemo(() => createListCollection({
        items: items,
        itemToString: (item) => (item ? item[mainKey] : ""),
        itemToValue: (item) => (item ? item[mainKey] : ""),
    }), [items, mainKey])

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        if (abortRef.current) abortRef.current.abort()

        if (!inputValue.trim()) {
            setItems([])
            setLoading(false)
            return
        }

        setLoading(true)

        debounceRef.current = setTimeout(async () => {
            const controller = new AbortController()
            abortRef.current = controller

            try {
                const params = new URLSearchParams({ query: inputValue })
                Object.entries(searchParams).forEach(([key, val]) => {
                    if (val) params.set(key, val as string)
                })
                const response = await fetch(`${props.url}?${params}`, {
                    signal: controller.signal
                })
                const data = await response.json()
                if (!controller.signal.aborted) {
                    setItems(Array.isArray(data) ? data : [])
                }
            } catch (err: any) {
                if (err.name !== "AbortError") {
                    setItems([])
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false)
                }
            }
        }, 300)

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current)
        }
    }, [inputValue, props.url, searchParams])

    useEffect(() => {
        const selectedItem = items.find(i => i[mainKey] === value[0]);
        if (value[0] !== undefined) {
             props.onChange(props.field, value[0], selectedItem)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

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
                        {loading ? (
                            <HStack p="2">
                                <Spinner size="xs" borderWidth="1px" />
                                <Span>Loading...</Span>
                            </HStack>
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
