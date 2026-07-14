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
} from "@chakra-ui/react"
import { MdDeleteForever, MdAdd, MdRemove } from "react-icons/md"

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
        <Select.Trigger borderColor="border.emphasized" bg="bg.subtle" color="fg" fontSize="sm" px={2} minH="36px">
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

  const categories = useMemo(() => {
    if (!metrics?.categories) return []
    return metrics.categories.map((c: any) => ({ value: c.id, label: c.name }))
  }, [metrics])

  const getMetricsForCategory = (categoryId: string) => {
    if (!metrics?.categories) return []
    const cat = metrics.categories.find((c: any) => c.id === categoryId)
    if (!cat?.metrics) return []
    return cat.metrics.map((m: any) => ({ value: m.id, label: m.name, type: m.type }))
  }

  const handleChange = (index: number, field: string, value: any) => {
    const newArr = [...localCriteria]
    if (field === "category") {
      newArr[index] = {
        category: value,
        metric: "",
        metric_name: "",
        metric_type: "number",
        operator: "gt",
        value: null,
        value_upper: null,
        ...(showWeight ? { weightage: 5 } : {}),
      }
    } else if (field === "metric") {
      const cat = metrics?.categories?.find((c: any) => c.id === newArr[index].category)
      const metricDef = cat?.metrics?.find((m: any) => m.id === value)
      const rawType = metricDef?.type || "number"
      const mType = OPERATORS_BY_TYPE[rawType] ? rawType : "number"
      const ops = OPERATORS_BY_TYPE[mType]
      newArr[index] = {
        ...newArr[index],
        metric: value,
        metric_name: metricDef?.name || value,
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
      category: "",
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
      <Flex
        gap={1}
        px={2}
        py={1}
        bg="bg.muted"
        borderTopRadius="sm"
        border="1px solid"
        borderColor="border"
        borderBottom="none"
        fontSize="xs"
        fontWeight="bold"
        color="fg.muted"
        letterSpacing="widest"
      >
        <Box flex={1.5}>CATEGORY</Box>
        <Box flex={2}>METRIC</Box>
        {showWeight && <Box width="44px" textAlign="center" flexShrink={0}>WGT</Box>}
        <Box flex={1}>OP</Box>
        <Box flex={1.5}>VALUE</Box>
        <Box width="32px" />
      </Flex>

      {localCriteria.length === 0 ? (
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
          <Text fontSize="sm" color="fg.muted">{emptyStateTitle}</Text>
          <Text fontSize="xs" color="fg.muted">{emptyStateSubtitle}</Text>
        </Flex>
      ) : (
        localCriteria.map((criterion, index) => {
          const availableMetrics = getMetricsForCategory(criterion.category)
          const operators = OPERATORS_BY_TYPE[criterion.metric_type] || OPERATORS_BY_TYPE.number
          const isBetween = criterion.operator === "between"
          const iType = inputType(criterion.metric_type)
          const isLast = index === localCriteria.length - 1

          return (
            <Flex
              key={index}
              gap={1.5}
               px={2}
               py={1}
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
              {showWeight && (
                <Box width="44px" flexShrink={0} textAlign="center">
                  <Flex align="center" justify="center" gap={0}>
                    <IconButton
                      size="xs"
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
                    <Text fontSize="xs" fontWeight="bold" color="fg" minW="16px" textAlign="center" userSelect="none">
                      {criterion.weightage ?? 5}
                    </Text>
                    <IconButton
                      size="xs"
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
              )}
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
                  size="xs"
                  type={iType}
                  step="any"
                  placeholder={isBetween ? "Low" : "Value"}
                  value={criterion.value ?? ""}
                  onChange={(e) => handleChange(index, "value", iType === "number" ? (e.target.value ? Number(e.target.value) : null) : e.target.value)}
                  bg="bg.subtle"
                  border="1px solid"
                  borderColor="border.emphasized"
                  _focus={{ borderColor: "fg.muted" }}
                  color="fg"
                    rounded="sm"
                    fontSize="sm"
                    minH="36px"
                    px={2}
                  />
                </Box>
                {isBetween && (
                <Box flex={1}>
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
                    borderColor="border.emphasized"
                    _focus={{ borderColor: "fg.muted" }}
                    color="fg"
                    rounded="sm"
                    fontSize="sm"
                    minH="36px"
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
          )
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
    </Flex>
  )
}
