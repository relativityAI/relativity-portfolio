import { Flex, Text } from "@chakra-ui/react"

interface SectionHeaderProps {
  title: string;
  description: string;
  first?: boolean;
  sequenceNumber?: number;
}

export default function SectionHeader({ title, description, first, sequenceNumber }: SectionHeaderProps) {
  return (
    <Flex
      direction="column"
      gap={2}
      mt={first ? 0 : 14}
      pt={4}
      pb={4}
      borderBottom="1px solid var(--hairline)"
    >
      {sequenceNumber != null && (
        <Text
          fontSize="11px"
          fontWeight={500}
          color="var(--ink-tertiary)"
          fontFamily="var(--font-mono)"
          letterSpacing="0.06em"
        >
          {String(sequenceNumber).padStart(2, "0")}
        </Text>
      )}
      <Text fontSize="18px" fontWeight={600} color="var(--ink-primary)">
        {title}
      </Text>
      {description && (
        <Text fontSize="13px" color="var(--ink-secondary)" lineHeight="relaxed">
          {description}
        </Text>
      )}
    </Flex>
  )
}
