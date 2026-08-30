import { useState, useEffect } from "react"
import {
  Flex,
  Textarea,
  Button,
  Input,
  Box,
  Text,
  IconButton,
} from "@chakra-ui/react"
import { MdDeleteForever, MdAdd, MdRemove, MdAutoAwesome } from "react-icons/md"
import { motion, AnimatePresence } from "motion/react"
import { dur, ease } from "@/lib/motion"

interface ListEditorItem {
  id: string;
  label?: string;
  content: string;
  weightage?: number;
}

interface ListEditorProps {
  items: ListEditorItem[];
  onChange: (items: ListEditorItem[]) => void;
  showWeight?: boolean;
  showLabel?: boolean;
  labelPlaceholder: string;
  contentPlaceholder: string;
  emptyStateTitle: string;
  emptyStateSubtitle: string;
  addButtonLabel: string;
  onDraft?: () => Promise<void> | void;
  drafting?: boolean;
}

function WeightStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Flex align="center" justify={{ base: "flex-start", md: "center" }} gap={0}>
      <IconButton
        size="xs"
        variant="subtle"
        color="fg.muted"
        _hover={{ color: "fg" }}
        onClick={() => onChange(Math.max(1, value - 1))}
        h="22px"
        minW={{ base: "44px", md: "14px" }}
        minH={{ base: "44px", md: "22px" }}
        p={0}
      >
        <MdRemove size={10} />
      </IconButton>
      <Text fontSize="xs" fontWeight="bold" color="fg" minW="16px" textAlign="center" userSelect="none">
        {value}
      </Text>
      <IconButton
        size="xs"
        variant="subtle"
        color="fg.muted"
        _hover={{ color: "fg" }}
        onClick={() => onChange(Math.min(10, value + 1))}
        h="22px"
        minW={{ base: "44px", md: "14px" }}
        minH={{ base: "44px", md: "22px" }}
        p={0}
      >
        <MdAdd size={10} />
      </IconButton>
    </Flex>
  )
}

export default function ListEditor(props: ListEditorProps) {
  const [items, setItems] = useState<ListEditorItem[]>(() =>
    (props.items || []).map((item, i) => ({
      ...item,
      id: item.id || `__le_${i}_${Date.now()}`
    }))
  )

  useEffect(() => {
    setItems(prev => {
      const incoming = props.items || []
      const contentEq = (a: any, b: any) => a.label === b.label && a.content === b.content && a.weightage === b.weightage
      if (prev.length === incoming.length && prev.every((p, i) => contentEq(p, incoming[i]))) {
        return prev
      }
      return incoming.map((item, i) => ({
        ...item,
        id: item.id || prev[i]?.id || `__le_${i}_${Date.now()}`
      }))
    })
  }, [props.items])

  const handleChange = (index: number, field: string, value: any) => {
    const newArr = [...items]
    newArr[index] = { ...newArr[index], [field]: value }
    setItems(newArr)
    props.onChange(newArr)
  }

  const addItem = (e: any) => {
    e.preventDefault()
    const newItem: ListEditorItem = {
      id: String(Date.now()),
      label: "",
      content: "",
      ...(props.showWeight ? { weightage: 5 } : {}),

    }
    const newArr = [...items, newItem]
    setItems(newArr)
    props.onChange(newArr)
  }

  const deleteItem = (idx: number) => () => {
    const reduced = items.filter((_, index) => index !== idx)
    setItems(reduced)
    props.onChange(reduced)
  }

  return (
    <Flex direction="column" width="full">
      <Box overflowX="auto" border="1px solid" borderColor="border" borderRadius="sm">
      {items.length === 0 ? (
        <Flex direction="column" align="center" gap={2} py={8} minW="600px">
          <Text fontSize="sm" color="fg.muted">{props.emptyStateTitle}</Text>
          <Text fontSize="xs" color="fg.muted">{props.emptyStateSubtitle}</Text>
        </Flex>
      ) : (
        <>
          <Flex
            gap={3}
            px={3}
            py={2}
            bg="bg.muted"
            borderBottom="1px solid"
            borderColor="border"
            fontSize="2xs"
            fontWeight="bold"
            color="fg.muted"
            letterSpacing="widest"
            minW="640px"
          >
            {props.showLabel !== false && <Box flex={1.5}>LABEL</Box>}
            {props.showWeight && <Box width={{ base: "116px", md: "52px" }} textAlign="center" flexShrink={0}>WGT</Box>}
            <Box flex={3}>DETAILS</Box>
            <Box width="32px" flexShrink={0} />
          </Flex>

          <AnimatePresence initial={false}>
          {items.map((item, index) => {
            const isLast = index === items.length - 1
            return (
              <Flex
                as={motion.div}
                layout
                key={item.id || index}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, height: 0 }}
                transition={{ duration: dur.base, ease }}
                gap={3}
                px={3}
                py={2.5}
                align="flex-start"
                direction="row"
                minW="640px"
                borderBottom={isLast ? "none" : "1px solid"}
                borderColor="border"
                bg={index % 2 === 0 ? "bg.subtle/30" : "transparent"}
                _hover={{ bg: "bg.muted/50" }}
              >
                {props.showLabel !== false && (
                  <Box flex={1.5}>
                    <Input
                      variant="subtle"
                      size="xs"
                      placeholder={props.labelPlaceholder}
                      value={item.label || ""}
                      onChange={(e) => handleChange(index, "label", e.target.value)}
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
                  </Box>
                )}
                {props.showWeight && (
                  <Box width={{ base: "116px", md: "52px" }} flexShrink={0} textAlign="center">
                    <WeightStepper
                      value={item.weightage ?? 5}
                      onChange={(v) => handleChange(index, "weightage", v)}
                    />
                  </Box>
                )}
                <Box flex={3}>
                  <Textarea
                    autoresize
                    variant="subtle"
                    size="xs"
                    minH="36px"
                    maxH="40lh"
                    placeholder={props.contentPlaceholder}
                    value={item.content}
                    onChange={(e) => handleChange(index, "content", e.target.value)}
                    bg="bg.subtle"
                    border="1px solid"
                    borderColor="var(--hairline)"
                    _focus={{ borderColor: "fg.muted" }}
                    color="fg"
                    rounded="sm"
                    fontSize="sm"
                    px={2}
                    py={1}
                    lineHeight="short"
                  />
                </Box>
                <Box width="32px" flexShrink={0} display="flex" justify="flex-start">
                  <Button
                    size="xs"
                    variant="subtle"
                    color="fg.muted"
                    _hover={{ color: "red.500", bg: "transparent" }}
                    onClick={deleteItem(index)}
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
        </>
      )}
      </Box>

      <Flex gap={2} mt={3} alignSelf="flex-start">
        <Button
          variant="subtle"
          color="fg.subtle"
          size="sm"
          onClick={addItem}
          fontWeight="bold"
          borderStyle="dashed"
          borderColor="var(--hairline)"
          _hover={{ color: "fg", bg: "var(--surface-recessed)" }}
          px={5}
        >
          <MdAdd />
          {props.addButtonLabel}
        </Button>
        {props.onDraft && (
          <Button
            variant="subtle"
            color="var(--accent-primary)"
            size="sm"
            onClick={() => props.onDraft!()}
            loading={props.drafting}
            loadingText="DRAFTING..."
            fontWeight="bold"
            borderStyle="dashed"
            borderColor="border"
            _hover={{ bg: "bg.muted", borderColor: "border.emphasized" }}
            px={5}
          >
            <MdAutoAwesome />
            DRAFT WITH AI
          </Button>
        )}
      </Flex>
    </Flex>
  )
}
