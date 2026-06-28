import { useState, useEffect, useMemo } from "react"
import {
    Flex,
    Button,
    Input,
    Box,
    Text,
    Select,
    createListCollection,
    Portal,
    Badge,
    IconButton,
} from "@chakra-ui/react"
import { MdDeleteForever, MdAdd, MdRemove, MdFunctions, MdWarning } from "react-icons/md";

interface ProfileQuantitativeProps {
    data: any[];
    onUpdate: (data: any[]) => void;
    id: string;
    name: string;
    metrics: any;
    source: string;
    onSourceChange: (source: string) => void;
}

const SOURCE_OPTIONS = createListCollection({
    items: [
        { value: "SEC", label: "SEC (US Market)" },
        { value: "NSE", label: "NSE (Indian Market)" },
    ],
    itemToString: (item: any) => item.label,
    itemToValue: (item: any) => item.value,
});

const OPERATORS_BY_TYPE: Record<string, { value: string; label: string }[]> = {
    text: [
        { value: "eq", label: "=" },
        { value: "neq", label: "≠" },
    ],
    number: [
        { value: "gt", label: ">" },
        { value: "gte", label: "≥" },
        { value: "lt", label: "<" },
        { value: "lte", label: "≤" },
        { value: "eq", label: "=" },
        { value: "between", label: "between" },
    ],
    currency: [
        { value: "gt", label: ">" },
        { value: "gte", label: "≥" },
        { value: "lt", label: "<" },
        { value: "lte", label: "≤" },
        { value: "eq", label: "=" },
        { value: "between", label: "between" },
    ],
    percentage: [
        { value: "gt", label: ">" },
        { value: "gte", label: "≥" },
        { value: "lt", label: "<" },
        { value: "lte", label: "≤" },
        { value: "eq", label: "=" },
        { value: "between", label: "between" },
    ],
    date: [
        { value: "before", label: "< before" },
        { value: "after", label: "> after" },
        { value: "eq", label: "on" },
        { value: "between", label: "between" },
    ],
};

function SelectInput({ value, options, onChange, placeholder, width }: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (v: string) => void;
    placeholder?: string;
    width?: string;
}) {
    const collection = useMemo(() => createListCollection({
        items: options,
        itemToString: (item) => item.label,
        itemToValue: (item) => item.value,
    }), [options]);

    return (
        <Select.Root
            collection={collection}
            value={value ? [value] : []}
            onValueChange={(e) => onChange(e.value[0])}
            size="2xs"
            width={width || "full"}
        >
            <Select.HiddenSelect />
            <Select.Control>
                <Select.Trigger borderColor="border.emphasized" bg="bg.subtle" color="fg" fontSize="xs" px={2} minH="28px">
                    <Select.ValueText placeholder={placeholder || "Select..."} />
                </Select.Trigger>
                <Select.IndicatorGroup>
                    <Select.Indicator />
                </Select.IndicatorGroup>
            </Select.Control>
            <Portal>
                <Select.Positioner>
                    <Select.Content>
                        {collection.items.map((item) => (
                            <Select.Item item={item} key={item.value}>
                                {item.label}
                                <Select.ItemIndicator />
                            </Select.Item>
                        ))}
                    </Select.Content>
                </Select.Positioner>
            </Portal>
        </Select.Root>
    );
}

export default function ProfileQuantitative(props: ProfileQuantitativeProps) {
    const [criteria, setCriteria] = useState<any[]>(props.data || []);
    const noSource = !props.source;

    useEffect(() => {
        setCriteria(props.data || []);
    }, [props.data]);

    const categories = useMemo(() => {
        if (!props.metrics?.categories) return [];
        return props.metrics.categories.map((c: any) => ({ value: c.id, label: c.name }));
    }, [props.metrics]);

    const getMetricsForCategory = (categoryId: string) => {
        if (!props.metrics?.categories) return [];
        const cat = props.metrics.categories.find((c: any) => c.id === categoryId);
        if (!cat?.metrics) return [];
        return cat.metrics.map((m: any) => ({ value: m.id, label: m.name, type: m.type }));
    };

    const handleChange = (index: number, field: string, value: any) => {
        const newArr = [...criteria];
        if (field === "category") {
            newArr[index] = {
                category: value,
                metric: "",
                metric_name: "",
                metric_type: "number",
                operator: "gt",
                value: "",
                value_upper: null,
                weightage: 5,
            };
        } else if (field === "metric") {
            const cat = props.metrics?.categories?.find((c: any) => c.id === newArr[index].category);
            const metricDef = cat?.metrics?.find((m: any) => m.id === value);
            const mType = metricDef?.type || "number";
            const ops = OPERATORS_BY_TYPE[mType] || OPERATORS_BY_TYPE.number;
            newArr[index] = {
                ...newArr[index],
                metric: value,
                metric_name: metricDef?.name || value,
                metric_type: mType,
                operator: ops[0]?.value || "gt",
                value: mType === "date" ? "" : "",
                value_upper: null,
                weightage: newArr[index].weightage ?? 5,
            };
        } else {
            newArr[index] = { ...newArr[index], [field]: value };
        }
        setCriteria(newArr);
        props.onUpdate(newArr);
    };

    const addCriterion = (e: any) => {
        e.preventDefault();
        const newCriteria = [...criteria, {
            category: "",
            metric: "",
            metric_name: "",
            metric_type: "number",
            operator: "gt",
            value: "",
            value_upper: null,
            weightage: 5,
        }];
        setCriteria(newCriteria);
        props.onUpdate(newCriteria);
    };

    const deleteCriterion = (idx: number) => () => {
        const reduced = criteria.filter((_, index) => index !== idx);
        setCriteria(reduced);
        props.onUpdate(reduced);
    };

    const handleSourceChange = (newSource: string) => {
        if (criteria.length > 0) {
            const confirmed = window.confirm(
                "Changing the data source will remove all existing quantitative criteria. Continue?"
            );
            if (!confirmed) return;
        }
        props.onSourceChange(newSource);
    };

    const inputType = (metricType: string) => {
        switch (metricType) {
            case "number": return "number";
            case "currency": return "number";
            case "percentage": return "number";
            case "date": return "date";
            default: return "text";
        }
    };

    return (
        <Flex direction="column" gap={4} width="full">
            {/* Source selector */}
            <Flex align="center" gap={3}>
                <Text fontSize="2xs" fontWeight="bold" color="fg.muted" letterSpacing="widest" whiteSpace="nowrap">DATA SOURCE</Text>
                <Box width="220px">
                    <Select.Root
                        collection={SOURCE_OPTIONS}
                        value={props.source ? [props.source] : []}
                        onValueChange={(e) => handleSourceChange(e.value[0])}
                        size="sm"
                    >
                        <Select.HiddenSelect />
                        <Select.Control>
                            <Select.Trigger borderColor="border.emphasized" bg="bg.muted" color="fg">
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
                {noSource && (
                    <Badge variant="surface" colorPalette="orange" size="xs">
                        <MdWarning style={{ display: "inline", marginRight: 4 }} />
                        Select source to configure metrics
                    </Badge>
                )}
            </Flex>

            {noSource ? (
                <Flex direction="column" align="center" gap={2} py={10} border="1px solid" borderColor="border" rounded="sm">
                    <MdFunctions size={24} color="fg.muted" />
                    <Text fontSize="sm" color="fg.muted">Select a data source above to configure quantitative criteria</Text>
                </Flex>
            ) : (
                <>
                    {/* Header row */}
                    <Flex
                        gap={1}
                        px={2}
                        py={1}
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
                        <Box flex={1.5}>CATEGORY</Box>
                        <Box flex={2}>METRIC</Box>
                        <Box width="44px" textAlign="center" flexShrink={0}>WGT</Box>
                        <Box flex={1}>OP</Box>
                        <Box flex={1.5}>VALUE</Box>
                        <Box width="32px" />
                    </Flex>

                    {criteria.length === 0 ? (
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
                            <Text fontSize="sm" color="fg.muted">No quantitative criteria yet</Text>
                            <Text fontSize="xs" color="fg.muted">Add numerical conditions to filter stocks</Text>
                        </Flex>
                    ) : (
                        criteria.map((criterion, index) => {
                            const availableMetrics = getMetricsForCategory(criterion.category);
                            const operators = OPERATORS_BY_TYPE[criterion.metric_type] || OPERATORS_BY_TYPE.number;
                            const isBetween = criterion.operator === "between";
                            const iType = inputType(criterion.metric_type);
                            const isLast = index === criteria.length - 1;

                            return (
                                <Flex
                                    key={index}
                                    gap={1}
                                    px={2}
                                    py={0.5}
                                    align="center"
                                    border="1px solid"
                                    borderColor="border"
                                    borderTop="none"
                                    borderBottomRadius={isLast ? "sm" : "none"}
                                    bg={index % 2 === 0 ? "bg.subtle/30" : "transparent"}
                                    _hover={{ bg: "bg.muted/50" }}
                                    transition="background 0.15s"
                                >
                                    <Box flex={1.5}>
                                        <SelectInput
                                            value={criterion.category}
                                            options={categories}
                                            onChange={(v) => handleChange(index, "category", v)}
                                            placeholder="Category"
                                        />
                                    </Box>
                                    <Box flex={2}>
                                        <SelectInput
                                            value={criterion.metric}
                                            options={availableMetrics}
                                            onChange={(v) => handleChange(index, "metric", v)}
                                            placeholder="Metric"
                                        />
                                    </Box>
                                    <Box width="44px" flexShrink={0} textAlign="center">
                                        <Flex align="center" justify="center" gap={0}>
                                            <IconButton
                                                size="2xs"
                                                variant="ghost"
                                                color="fg.muted"
                                                _hover={{ color: "fg" }}
                                                onClick={() => handleChange(index, "weightage", Math.max(1, (criterion.weightage ?? 5) - 1))}
                                                minW="14px"
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
                                                {criterion.weightage ?? 5}
                                            </Text>
                                            <IconButton
                                                size="2xs"
                                                variant="ghost"
                                                color="fg.muted"
                                                _hover={{ color: "fg" }}
                                                onClick={() => handleChange(index, "weightage", Math.min(10, (criterion.weightage ?? 5) + 1))}
                                                minW="14px"
                                                h="22px"
                                                p={0}
                                            >
                                                <MdAdd size={10} />
                                            </IconButton>
                                        </Flex>
                                    </Box>
                                    <Box flex={1}>
                                        <SelectInput
                                            value={criterion.operator}
                                            options={operators}
                                            onChange={(v) => handleChange(index, "operator", v)}
                                        />
                                    </Box>
                                    <Box flex={isBetween ? 1 : 1.5}>
                                        <Input
                                            variant="subtle"
                                            size="2xs"
                                            type={iType}
                                            step="any"
                                            placeholder={isBetween ? "Low" : "Value"}
                                            value={criterion.value ?? ""}
                                            onChange={(e) => handleChange(index, "value", iType === "number" ? (e.target.value ? Number(e.target.value) : "") : e.target.value)}
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
                                    {isBetween && (
                                        <Box flex={1}>
                                            <Input
                                                variant="subtle"
                                                size="2xs"
                                                type={iType}
                                                step="any"
                                                placeholder="High"
                                                value={criterion.value_upper ?? ""}
                                                onChange={(e) => handleChange(index, "value_upper", iType === "number" ? (e.target.value ? Number(e.target.value) : "") : e.target.value)}
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
                                    )}
                                    <Box width="32px" flexShrink={0}>
                                        <Button
                                            size="xs"
                                            variant="ghost"
                                            color="fg.muted"
                                            _hover={{ color: "red.500", bg: "transparent" }}
                                            onClick={deleteCriterion(index)}
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
                    onClick={addCriterion}
                    alignSelf="flex-start"
                    mt={3}
                    fontWeight="bold"
                    borderStyle="dashed"
                    borderColor="border"
                    _hover={{ color: "fg", bg: "bg.muted", borderColor: "border.emphasized" }}
                        px={5}
                    >
                        <MdAdd />
                        ADD CRITERION
                    </Button>
                </>
            )}
        </Flex>
    );
}