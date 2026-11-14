import { Select, Portal, createListCollection } from "@chakra-ui/react"

export default function DropDown(props: any) {

    const safeOptions = (props.options || []).filter(Boolean);

    let options = createListCollection({ items: safeOptions });

    return (
        <Select.Root
            collection={options}
            value={[props.initValue]}
            size="xs"
            colorPalette={props.color}
            width={props.width || "100px"}
            onValueChange={(details) => props.onChange({ target: { value: details.value[0] } })}
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
                            options.items.map((item: any, index) => (
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