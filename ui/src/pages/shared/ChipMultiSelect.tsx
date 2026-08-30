import { Flex, Text, Button } from "@chakra-ui/react"
import { motion } from "motion/react";

interface ChipMultiSelectProps {
  label: string;
  description: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
  multiple?: boolean;
  columns?: number;
}

export default function ChipMultiSelect({ label, description, options, selected, onChange, multiple = true, columns }: ChipMultiSelectProps) {
  const toggle = (value: string) => {
    if (multiple) {
      const next = selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
      onChange(next)
    } else {
      onChange(selected.includes(value) ? [] : [value])
    }
  }

  return (
    <Flex direction="column" gap={2}>
      {label && <Text fontSize="sm" fontWeight={500} color="var(--ink-primary)">{label}</Text>}
      {description && <Text fontSize="12px" color="var(--ink-tertiary)" lineHeight="short">{description}</Text>}
      <Flex
        wrap={columns ? undefined : "wrap"}
        gap={2}
        display={columns ? "grid" : undefined}
        gridTemplateColumns={columns ? { base: "1fr", md: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
      >
        {options.map((opt) => {
          const isActive = selected.includes(opt.value)
          return (
            <Button
              as={motion.button}
              whileTap={{ scale: 0.96 }}
              key={opt.value}
              size="sm"
              variant="subtle"
              bg={isActive ? "color-mix(in srgb, var(--accent-primary) 12%, transparent)" : "transparent"}
              color={isActive ? "var(--ink-primary)" : "var(--ink-tertiary)"}
              border="1px solid"
              borderColor={isActive ? "var(--accent-primary)" : "var(--hairline)"}
              _hover={{
                bg: "var(--surface-recessed)",
              }}
              onClick={() => toggle(opt.value)}
              px={3}
              py={1}
              h="auto"
              w={columns ? "full" : undefined}
              fontSize="12px"
              fontWeight={isActive ? 500 : 400}
              borderRadius="2px"
              transition="background 160ms"
            >
              {opt.label}
            </Button>
          )
        })}
      </Flex>
    </Flex>
  )
}
