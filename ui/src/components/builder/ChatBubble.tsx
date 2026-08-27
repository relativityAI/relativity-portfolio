import { Box, Flex, Text } from "@chakra-ui/react";
import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";
import OptionCards from "./OptionCards";

export interface ChatMsg {
  id: string;
  role: "assistant" | "user";
  content: string;
  options?: { id: string; label: string; description?: string }[];
  annotations?: { what: string; basis: string }[];
  timestamp: number;
}

interface ChatBubbleProps {
  message: ChatMsg;
  onOptionSelect?: (option: { id: string; label: string; description?: string }) => void;
  isLatest?: boolean;
}

export default function ChatBubble({ message, onOptionSelect, isLatest }: ChatBubbleProps) {
  const isAssistant = message.role === "assistant";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur.base, ease }}
      style={{ width: "100%" }}
    >
      <Flex direction="column" align={isAssistant ? "flex-start" : "flex-end"} gap={1}>
        {isAssistant && (
          <Text fontSize="10px" fontWeight={500} color="var(--ink-tertiary)" letterSpacing="0.04em" textTransform="uppercase" px={1}>
            Builder
          </Text>
        )}
        <Box
          maxW="85%"
          px={3.5}
          py={2.5}
          borderRadius="4px"
          bg={isAssistant ? "var(--surface-recessed)" : "var(--accent-primary)"}
          color={isAssistant ? "var(--ink-primary)" : "#fff"}
          fontSize="13px"
          lineHeight="1.55"
          whiteSpace="pre-wrap"
          border={isAssistant ? "1px solid var(--hairline)" : "none"}
        >
          {message.content}
        </Box>
        {isAssistant && message.options && message.options.length > 0 && onOptionSelect && (
          <Box maxW="85%">
            <OptionCards options={message.options} onSelect={onOptionSelect} disabled={!isLatest} />
          </Box>
        )}
        {isAssistant && message.annotations && message.annotations.length > 0 && (
          <Box maxW="85%" w="full" mt={1} p={2.5} borderRadius="4px" border="1px solid var(--hairline)" bg="var(--surface-panel)">
            <Text fontSize="10px" fontWeight={600} color="var(--ink-tertiary)" letterSpacing="0.04em" textTransform="uppercase" mb={1}>
              Decisions &amp; sources
            </Text>
            {message.annotations.map((a, i) => (
              <Flex key={i} gap={2} py={0.5} align="flex-start">
                <Box flexShrink={0} mt="5px" w="4px" h="4px" borderRadius="50%" bg="var(--accent-primary)" />
                <Text fontSize="11px" lineHeight="1.4" color="var(--ink-secondary)">
                  <Text as="span" fontWeight={500} color="var(--ink-primary)">{a.what}</Text>
                  {" — "}
                  {a.basis}
                </Text>
              </Flex>
            ))}
          </Box>
        )}
      </Flex>
    </motion.div>
  );
}
