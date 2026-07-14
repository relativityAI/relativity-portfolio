import { Flex, Text, Box } from "@chakra-ui/react"
import { MdChevronRight } from "react-icons/md"

interface OverviewSection {
  id: string;
  label: string;
  summary: string;
  hasContent: boolean;
}

interface ProfileOverviewProps {
  profileName: string;
  isDirty: boolean;
  sections: OverviewSection[];
  onNavigate: (section: string) => void;
}

export default function ProfileOverview({ profileName, isDirty, sections, onNavigate }: ProfileOverviewProps) {
  return (
    <Flex direction="column" gap={6}>
      <Flex direction="column" gap={1}>
        <Text fontSize="md" fontWeight={600} color="var(--ink-primary)">
          {profileName || "Untitled Profile"}
        </Text>
        <Text fontSize="12px" color="var(--ink-tertiary)">
          {isDirty ? "Unsaved changes" : "All changes saved"}
        </Text>
      </Flex>

      <Flex direction="column" gap={0}>
        {sections.map((section) => (
          <Flex
            key={section.id}
            align="center"
            gap={3}
            px={3}
            py={2.5}
            cursor="pointer"
            _hover={{ bg: "var(--surface-recessed)" }}
            onClick={() => onNavigate(section.id)}
            transition="background 80ms"
            borderBottom="1px solid var(--hairline)"
            _last={{ borderBottom: "none" }}
          >
            <Box
              w="6px"
              h="6px"
              borderRadius="1px"
              bg={section.hasContent ? "var(--signal-positive)" : "transparent"}
              border={section.hasContent ? "none" : "1px solid var(--hairline)"}
              flexShrink={0}
            />
            <Box flex={1} minW={0}>
              <Text fontSize="13px" fontWeight={500} color="var(--ink-primary)" truncate>
                {section.label}
              </Text>
              <Text fontSize="12px" color="var(--ink-tertiary)" truncate>
                {section.summary}
              </Text>
            </Box>
            <MdChevronRight size={14} color="var(--ink-tertiary)" style={{ flexShrink: 0 }} />
          </Flex>
        ))}
      </Flex>
    </Flex>
  )
}
