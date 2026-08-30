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
  IconButton,
  Combobox,
  useFilter,
} from "@chakra-ui/react"
import { MdDeleteForever, MdAdd, MdRemove } from "react-icons/md"
import { motion, AnimatePresence } from "motion/react"
import { dur, ease } from "@/lib/motion"

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
}

function SelectInput({ value, options, onChange, placeholder, width }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  placeholder?: string;
  width?: string;
}) {
  const collection = useMemo(() => createListCollection({
    items: options,
    itemToString: (item: any) => item.label,
    itemToValue: (item: any) => item.value,
  }), [options])

  return (
    <Select.Root
      collection={collection}
      value={value ? [value] : []}
      onValueChange={(e) => onChange(e.value[0])}
      size="xs"
      width={width || "full"}
    >
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger borderColor="var(--hairline)" bg="bg.subtle" color="fg" fontSize="sm" px={2} minH="36px">
          <Select.ValueText placeholder={placeholder || "Select..."} />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>
      <Portal>
        <Select.Positioner>
          <Select.Content fontSize="sm">
            {collection.items.map((item: any) => (
              <Select.Item item={item} key={item.value} fontSize="sm" py={1.5} px={3}>
                {item.label}
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  )
}

function FieldCombobox({ value, options, onChange, placeholder }: {
  value: string;
  options: { value: string; label: string; type?: string }[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { contains } = useFilter({ sensitivity: "base" })

  // Keep saved-but-no-longer-listed metrics visible so existing agents render.
  const allOptions = useMemo(() => {
    if (!value) return options
    const current = options.find((o) => o.value === value)
    if (current) return options
    return [{ value, label: `${value} (unavailable)` }, ...options]
  }, [options, value])

  const collection = useMemo(
    () =>
      createListCollection({
        items: allOptions,
        itemToString: (item: any) => item.label,
        itemToValue: (item: any) => item.value,
        filter: contains,
      }),
    [allOptions, contains]
  )

  const selectedLabel = allOptions.find((o) => o.value === value)?.label

  return (
    <Combobox.Root
      collection={collection}
      value={value ? [value] : []}
      onValueChange={(e) => onChange(e.value[0])}
      inputBehavior="autohighlight"
      openOnClick
      positioning={{ sameWidth: false, fitContent: true }}
      width="full"
    >
      <Combobox.Control>
        <Combobox.Input
          placeholder={placeholder || "Search metric..."}
          borderColor="var(--hairline)"
          bg="bg.subtle"
          color="fg"
          fontSize="sm"
          px={2}
          minH="36px"
          fontWeight={selectedLabel ? 500 : undefined}
        />
        <Combobox.IndicatorGroup>
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>
      <Portal>
        <Combobox.Positioner minW="240px">
          <Combobox.Content fontSize="sm" maxH="260px">
            {collection.items.length === 0 && (
              <Box px={3} py={2} fontSize="xs" color="fg.muted">No matching metrics</Box>
            )}
            {collection.items.map((item: any) => (
              <Combobox.Item item={item} key={item.value} fontSize="sm" py={1.5} px={3}>
                {item.label}
                <Combobox.ItemIndicator />
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  )
}

interface CriteriaBuilderProps {
  criteria: any[];
  onChange: (criteria: any[]) => void;
  metrics: any;
  showWeight?: boolean;
  emptyStateTitle?: string;
  emptyStateSubtitle?: string;
}

export default function CriteriaBuilder({
  criteria,
  onChange,
  metrics,
  showWeight = true,
  emptyStateTitle = "No criteria yet",
  emptyStateSubtitle = "Add conditions to filter stocks",
}: CriteriaBuilderProps) {
  const [localCriteria, setLocalCriteria] = useState<any[]>(criteria || [])

  useEffect(() => {
    setLocalCriteria(criteria || [])
  }, [criteria])

  const fieldOptions = useMemo(() => {
    const fields = metrics?.fields || []
    return fields.map((m: any) => ({ value: m.id, label: m.name, type: m.type }))
  }, [metrics])

  const handleChange = (index: number, field: string, value: any) => {
    const newArr = [...localCriteria]
    if (field === "metric") {
      const metricDef = fieldOptions.find((m: any) => m.value === value)
      const rawType = metricDef?.type || "number"
      const mType = OPERATORS_BY_TYPE[rawType] ? rawType : "number"
      const ops = OPERATORS_BY_TYPE[mType]
      newArr[index] = {
        ...newArr[index],
        metric: value,
        metric_name: metricDef?.label || value,
        metric_type: mType,
        operator: ops[0]?.value || "gt",
        value: null,
        value_upper: null,
      }
    } else {
      newArr[index] = { ...newArr[index], [field]: value }
    }
    setLocalCriteria(newArr)
    onChange(newArr)
  }

  const addCriterion = (e: any) => {
    e.preventDefault()
    const newItem: any = {
      metric: "",
      metric_name: "",
      metric_type: "number",
      operator: "gt",
      value: null,
      value_upper: null,
    }
    if (showWeight) newItem.weightage = 5
    const newArr = [...localCriteria, newItem]
    setLocalCriteria(newArr)
    onChange(newArr)
  }

  const deleteCriterion = (idx: number) => () => {
    const reduced = localCriteria.filter((_, index) => index !== idx)
    setLocalCriteria(reduced)
    onChange(reduced)
  }

  const inputType = (metricType: string) => {
    switch (metricType) {
      case "number": return "number"
      case "currency": return "number"
      case "percentage": return "number"
      case "date": return "date"
      default: return "text"
    }
  }

  if (!metrics) {
    return (
      <Flex direction="column" align="center" gap={2} py={10} border="1px solid" borderColor="border" rounded="sm">
        <Text fontSize="sm" color="fg.muted">Loading metrics...</Text>
      </Flex>
    )
  }

  return (
    <Flex direction="column" width="full">
      <Box overflowX="auto" border="1px solid" borderColor="border" borderRadius="sm">
        <Flex
          gap={1}
          px={2}
          py={1}
          bg="bg.muted"
          borderBottom="1px solid"
          borderColor="border"
          fontSize="xs"
          fontWeight="bold"
          color="fg.muted"
          letterSpacing="widest"
          minW="640px"
        >
          <Box flex={3}>METRIC</Box>
          {showWeight && <Box width={{ base: "116px", md: "44px" }} textAlign="center" flexShrink={0}>WGT</Box>}
          <Box flex={1}>OP</Box>
          <Box flex={1.5}>VALUE</Box>
          <Box width="32px" />
        </Flex>

        {localCriteria.length === 0 ? (
          <Flex direction="column" align="center" gap={2} py={8} minW="640px">
            <Text fontSize="sm" color="fg.muted">{emptyStateTitle}</Text>
            <Text fontSize="xs" color="fg.muted">{emptyStateSubtitle}</Text>
          </Flex>
        ) : (
          <AnimatePresence initial={false}>
          {localCriteria.map((criterion, index) => {
            const operators = OPERATORS_BY_TYPE[criterion.metric_type] || OPERATORS_BY_TYPE.number
            const isBetween = criterion.operator === "between"
            const iType = inputType(criterion.metric_type)
            const isLast = index === localCriteria.length - 1

            return (
              <Flex
                as={motion.div}
                layout
                key={index}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, height: 0 }}
                transition={{ duration: dur.base, ease }}
                gap={1.5}
                px={2}
                py={1.5}
                align="center"
                direction="row"
                minW="640px"
                borderBottom={isLast ? "none" : "1px solid"}
                borderColor="border"
                bg={index % 2 === 0 ? "bg.subtle/30" : "transparent"}
                _hover={{ bg: "bg.muted/50" }}
              >
                <Box flex={3}>
                  <FieldCombobox
                    value={criterion.metric}
                    options={fieldOptions}
                    onChange={(v) => handleChange(index, "metric", v)}
                  />
                </Box>
                {showWeight && (
                  <Box width={{ base: "116px", md: "44px" }} flexShrink={0} textAlign="center">
                    <Flex align="center" justify="center" gap={0}>
                      <IconButton
                        size="xs"
                        variant="subtle"
                        color="fg.muted"
                        _hover={{ color: "fg" }}
                        onClick={() => handleChange(index, "weightage", Math.max(1, (criterion.weightage ?? 5) - 1))}
                        h="22px"
                        minW={{ base: "44px", md: "14px" }}
                        minH={{ base: "44px", md: "22px" }}
                        p={0}
                      >
                        <MdRemove size={10} />
                      </IconButton>
                      <Text fontSize="xs" fontWeight="bold" color="fg" minW="16px" textAlign="center" userSelect="none">
                        {criterion.weightage ?? 5}
                      </Text>
                      <IconButton
                        size="xs"
                        variant="subtle"
                        color="fg.muted"
                        _hover={{ color: "fg" }}
                        onClick={() => handleChange(index, "weightage", Math.min(10, (criterion.weightage ?? 5) + 1))}
                        h="22px"
                        minW={{ base: "44px", md: "14px" }}
                        minH={{ base: "44px", md: "22px" }}
                        p={0}
                      >
                        <MdAdd size={10} />
                      </IconButton>
                    </Flex>
                  </Box>
                )}
                <Box flex={1}>
                  <SelectInput
                    value={criterion.operator}
                    options={operators}
                    onChange={(v) => handleChange(index, "operator", v)}
                  />
                </Box>
                <Box flex={isBetween ? 2.5 : 1.5}>
                  <Flex gap={1.5} align="center">
                    <Input
                      variant="subtle"
                      size="xs"
                      type={iType}
                      step="any"
                      placeholder={isBetween ? "Low" : "Value"}
                      value={criterion.value ?? ""}
                      onChange={(e) => handleChange(index, "value", iType === "number" ? (e.target.value ? Number(e.target.value) : null) : e.target.value)}
                      bg="bg.subtle"
                      border="1px solid"
                      borderColor="var(--hairline)"
                      _focus={{ borderColor: "fg.muted" }}
                      color="fg"
                      rounded="sm"
                      fontSize="sm"
                      minH="36px"
                      px={2}
                    />
                    {isBetween && (
                      <Input
                        variant="subtle"
                        size="xs"
                        type={iType}
                        step="any"
                        placeholder="High"
                        value={criterion.value_upper ?? ""}
                        onChange={(e) => handleChange(index, "value_upper", iType === "number" ? (e.target.value ? Number(e.target.value) : null) : e.target.value)}
                        bg="bg.subtle"
                        border="1px solid"
                        borderColor="var(--hairline)"
                        _focus={{ borderColor: "fg.muted" }}
                        color="fg"
                        rounded="sm"
                        fontSize="sm"
                        minH="36px"
                        px={2}
                      />
                    )}
                  </Flex>
                </Box>
                <Box width="32px" flexShrink={0} display="flex" justify="flex-start">
                  <Button
                    size="xs"
                    variant="subtle"
                    color="fg.muted"
                    _hover={{ color: "red.500", bg: "transparent" }}
                    onClick={deleteCriterion(index)}
                    h="auto"
                    minW={{ base: "44px", md: "auto" }}
                    minH={{ base: "44px", md: "auto" }}
                    p={1}
                  >
                    <MdDeleteForever size={16} />
                  </Button>
                </Box>
              </Flex>
            )
          })}
          </AnimatePresence>
        )}
      </Box>

      <Button
        variant="subtle"
        color="fg.subtle"
        size="sm"
        onClick={addCriterion}
        alignSelf="flex-start"
        mt={3}
        fontWeight="bold"
        borderStyle="dashed"
        borderColor="var(--hairline)"
        _hover={{ color: "fg", bg: "var(--surface-recessed)" }}
        px={5}
      >
        <MdAdd />
        ADD CRITERION
      </Button>
    </Flex>
  )
}
