import { Flex, Text, Textarea } from "@chakra-ui/react"

interface NarrativeFieldProps {
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minH?: string;
}

export default function NarrativeField({ label, description, value, onChange, placeholder, minH }: NarrativeFieldProps) {
  return (
    <Flex direction="column" gap={2}>
      <Text fontSize="sm" fontWeight="bold" color="fg">{label}</Text>
      <Text fontSize="xs" color="fg.muted" lineHeight="short">{description}</Text>
      <Textarea
        autoresize
        variant="subtle"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || `Describe ${label.toLowerCase()}...`}
        minH={minH || "80px"}
        bg="bg.subtle"
        border="1px solid"
        borderColor="border.emphasized"
        _focus={{ borderColor: "fg.muted" }}
        color="fg"
        rounded="sm"
        fontSize="sm"
        px={3}
        py={2}
        lineHeight="short"
      />
    </Flex>
  )
}
