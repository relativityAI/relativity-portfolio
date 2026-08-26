import { Box, Flex, Text } from "@chakra-ui/react";
import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";
import OptionCards from "./OptionCards";

export interface ChatMsg {
  id: string;
  role: "assistant" | "user";
  content: string;
  options?: { id: string; label: string; description?: string }[];
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
      </Flex>
    </motion.div>
  );
}
