import { Box, Flex, Text } from "@chakra-ui/react";
import { SOURCES } from "@/lib/dataSources";

function Track() {
  return (
    <Flex align="center" gap={3} px={1.5}>
      {SOURCES.map((s) => (
        <Flex key={s.label} align="center" gap={1.5} borderRadius="full" border="1px solid var(--hairline)" bg="var(--surface-recessed)" px={3} py={1.5} flexShrink={0}>
          <s.icon size={12} color="var(--ink-tertiary)" />
          <Text fontFamily="var(--font-mono)" fontSize="xs" fontWeight={500} color="var(--ink-secondary)" whiteSpace="nowrap">
            {s.label}
          </Text>
        </Flex>
      ))}
    </Flex>
  );
}

export default function DataSourceMarquee() {
  return (
    <Box overflow="hidden" w="100%" aria-hidden="true">
      <Box className="marquee-track">
        <Track />
        <Track />
      </Box>
    </Box>
  );
}
