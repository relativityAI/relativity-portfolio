import { Select, Portal, createListCollection } from "@chakra-ui/react"
import { useEffect, useState } from "react";

export default function DropDown(props) {

    const safeOptions = (props.options || []).filter(Boolean);

    let options = createListCollection({ items: safeOptions });
    const [initValue, setInitValue] = useState("")

    const handleInitialValue = () => {

        if (options.items.includes(props.initValue)) {
            setInitValue( props.initValue)
        }


    }

    useEffect(()=>{
        handleInitialValue()
    }, [options])

    return (
        <Select.Root
            collection={options}
            defaultValue={[initValue]}
            size="xs"
            colorPalette={props.color}
            width="100px"
            onChange={props.onChange}
        >
            <Select.HiddenSelect />
            <Select.Control>
                <Select.Trigger
                    borderColor="colorPalette.muted"
                    bg="colorPalette.subtle"
                    color="colorPalette.fg">
                    <Select.ValueText placeholder="Choose" />
                </Select.Trigger>
                <Select.IndicatorGroup>
                    <Select.Indicator />
                </Select.IndicatorGroup>
            </Select.Control>
            <Portal>
                <Select.Positioner>
                    <Select.Content>
                        {
                            options.items.map((item, index) => (
                                <Select.Item item={item} key={index}>
                                    {item}
                                    <Select.ItemIndicator />
                                </Select.Item>
                            ))}
                    </Select.Content>
                </Select.Positioner>
            </Portal>
        </Select.Root>
    )
}