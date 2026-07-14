import { Flex, Text, Select, createListCollection, Portal, Box, Button } from "@chakra-ui/react"
import { useState } from "react"
import ProfileDataQualitative from "../ProfileQualitative"
import ProfileQuantitative from "../ProfileQuantitative"
import SectionBlock from "../shared/SectionBlock"
import SectionHeader from "../shared/SectionHeader"

const SOURCE_OPTIONS = createListCollection({
    items: [
        { value: "SEC", label: "SEC (US Market)" },
        { value: "NSE", label: "NSE (Indian Market)" },
    ],
    itemToString: (item: any) => item.label,
    itemToValue: (item: any) => item.value,
})

interface AssetEvalSectionProps {
    qualitative: any[];
    onQualitativeUpdate: (data: any[]) => void;
    quantitative: any[];
    onQuantitativeUpdate: (data: any[]) => void;
    id: string;
    name: string;
    metrics: any;
    source: string;
    onSourceChange: (source: string) => void;
}

export default function AssetEvalSection({
    qualitative,
    onQualitativeUpdate,
    quantitative,
    onQuantitativeUpdate,
    id,
    name,
    metrics,
    source,
    onSourceChange,
}: AssetEvalSectionProps) {
    const [showConfirm, setShowConfirm] = useState(false);
    const [pendingSource, setPendingSource] = useState<string | null>(null);
    const hasCriteria = (quantitative?.length || 0) > 0;

    const handleSourceSelect = (newSource: string) => {
        if (hasCriteria) {
            setPendingSource(newSource);
            setShowConfirm(true);
        } else {
            onSourceChange(newSource);
        }
    };

    const confirmSourceChange = () => {
        if (pendingSource) {
            onSourceChange(pendingSource);
            onQuantitativeUpdate([]);
        }
        setShowConfirm(false);
        setPendingSource(null);
    };

    const cancelSourceChange = () => {
        setShowConfirm(false);
        setPendingSource(null);
    };

    return (
        <>
            <SectionHeader
                title="Asset Evaluation"
                description="The complete toolkit for judging any single stock on its own merits."
                sequenceNumber={3}
            />
            <SectionBlock
                sectionId="asset_evaluation"
                subsectionId="qualitative"
                title="Qualitative"
                description="Text-based judgment calls on a company's quality that can't be reduced to a number."
            >
                <ProfileDataQualitative
                    name={name}
                    data={qualitative}
                    id={id}
                    metrics={metrics}
                    onUpdate={onQualitativeUpdate}
                />
            </SectionBlock>

            <Flex direction="column" gap={4} py={4}>
                <Flex align="center" gap={3}>
                    <Text
                        fontSize="10.5px"
                        fontWeight={500}
                        color="var(--ink-tertiary)"
                        letterSpacing="0.06em"
                        textTransform="uppercase"
                        whiteSpace="nowrap"
                    >
                        Data Source
                    </Text>
                    <Box width="220px">
                        <Select.Root
                            collection={SOURCE_OPTIONS}
                            value={source ? [source] : []}
                            onValueChange={(e) => handleSourceSelect(e.value[0])}
                            size="sm"
                        >
                            <Select.HiddenSelect />
                            <Select.Control>
                                <Select.Trigger
                                    borderColor="var(--hairline)"
                                    bg="var(--surface-panel)"
                                    color="var(--ink-primary)"
                                    borderRadius="2px"
                                >
                                    <Select.ValueText placeholder="Select source..." />
                                </Select.Trigger>
                                <Select.IndicatorGroup>
                                    <Select.Indicator />
                                </Select.IndicatorGroup>
                            </Select.Control>
                            <Portal>
                                <Select.Positioner>
                                    <Select.Content>
                                        {SOURCE_OPTIONS.items.map((item: any) => (
                                            <Select.Item item={item} key={item.value}>
                                                {item.label}
                                                <Select.ItemIndicator />
                                            </Select.Item>
                                        ))}
                                    </Select.Content>
                                </Select.Positioner>
                            </Portal>
                        </Select.Root>
                    </Box>
                    {!source && (
                        <Text fontSize="12px" color="var(--ink-tertiary)">
                            Select a source to configure metrics
                        </Text>
                    )}
                </Flex>

                {showConfirm && (
                    <Flex
                        direction="column"
                        gap={2}
                        py={3}
                        borderTop="1px solid var(--hairline)"
                    >
                        <Text fontSize="13px" color="var(--ink-secondary)">
                            Changing the data source will remove all existing criteria.
                        </Text>
                        <Flex gap={2}>
                            <Button
                                size="xs"
                                variant="ghost"
                                color="var(--ink-tertiary)"
                                _hover={{ color: "var(--ink-primary)" }}
                                onClick={cancelSourceChange}
                                fontWeight={500}
                            >
                                Cancel
                            </Button>
                            <Button
                                size="xs"
                                bg="var(--accent-primary)"
                                color="#fff"
                                _hover={{ opacity: 0.9 }}
                                borderRadius="2px"
                                onClick={confirmSourceChange}
                                fontWeight={500}
                            >
                                Confirm
                            </Button>
                        </Flex>
                    </Flex>
                )}
            </Flex>

            <SectionBlock
                sectionId="asset_evaluation"
                subsectionId="quantitative"
                title="Quantitative"
                description="Metric-driven quantitative criteria."
            >
                <ProfileQuantitative
                    name={name}
                    data={quantitative}
                    id={id}
                    metrics={metrics}
                    source={source}
                    onUpdate={onQuantitativeUpdate}
                />
            </SectionBlock>
        </>
    )
}
