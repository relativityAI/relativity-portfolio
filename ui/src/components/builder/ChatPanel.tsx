import { useState, useRef, useEffect } from "react";
import { Box, Flex, Input, IconButton, Text } from "@chakra-ui/react";
import { motion, AnimatePresence } from "motion/react";
import { MdSend, MdOutlineInfo } from "react-icons/md";
import { tap, type } from "@/lib/tokens";
import ChatBubble, { type ChatMsg } from "./ChatBubble";
import DocDropzone from "./DocDropzone";
import StepsTrace, { TraceBlock, type BuilderStep } from "./StepsTrace";

interface DocFile {
  filename: string;
  char_count: number;
  status: "uploading" | "processing" | "done" | "error";
  error?: string;
}

interface ChatPanelProps {
  messages: ChatMsg[];
  onSendMessage: (text: string) => void;
  onOptionSelect: (option: { id: string; label: string; description?: string }) => void;
  onUploadFiles: (files: File[]) => void;
  documents: DocFile[];
  onRemoveDocument?: (index: number) => void;
  isProcessing: boolean;
  steps?: BuilderStep[] | null;
  traces?: { key: string; title: string; steps: BuilderStep[] }[];
  disabled?: boolean;
}

export default function ChatPanel({
  messages,
  onSendMessage,
  onOptionSelect,
  onUploadFiles,
  documents,
  onRemoveDocument,
  isProcessing,
  steps,
  traces = [],
  disabled,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isProcessing || disabled) return;
    onSendMessage(text);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Find the last assistant message with options
  const lastOptionsIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.options?.length) return i;
    }
    return -1;
  })();

  return (
    <Flex direction="column" h="100%" minH={0} w="full">
      {/* Messages area */}
      <Box flex={1} overflowY="auto" px={4} py={4} aria-live="polite" aria-relevant="additions">
        <Flex direction="column" gap={3}>
          {messages.map((msg, i) => (
            <ChatBubble
              key={msg.id}
              message={msg}
              onOptionSelect={i === lastOptionsIdx ? onOptionSelect : undefined}
              isLatest={i === lastOptionsIdx}
            />
          ))}
          {traces.length > 0 && (
            <Box>
              <Text fontSize={type.micro} fontWeight={600} color="var(--ink-tertiary)" letterSpacing="0.04em" textTransform="uppercase" mb={1.5} mt={1}>
                How this was built
              </Text>
              <Flex direction="column" gap={1.5}>
                {traces.map((t) => (
                  <TraceBlock key={t.key} title={t.title || "Assist step"} steps={t.steps} />
                ))}
              </Flex>
            </Box>
          )}
          <AnimatePresence initial={false}>
            {steps && steps.length > 0 && (
              <motion.div key="steptrace" exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
                <StepsTrace steps={steps} />
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </Flex>
      </Box>

      {/* Document dropzone */}
      <Box px={4} pb={2} flexShrink={0}>
        <DocDropzone
          onUpload={onUploadFiles}
          documents={documents}
          onRemove={onRemoveDocument}
          disabled={disabled}
        />
      </Box>

      {/* Input area */}
      <Flex px={4} pb={3} pt={2} gap={2} align="center" flexShrink={0}>
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          size="sm"
          minH={`${tap}px`}
          flex={1}
          bg="var(--surface-panel)"
          border="1px solid var(--hairline)"
          borderRadius="3px"
          fontSize={type.body}
          _placeholder={{ color: "var(--ink-tertiary)" }}
          _focus={{ borderColor: "var(--accent-primary)", outline: "none" }}
          disabled={isProcessing || disabled}
        />
        <IconButton
          size="sm"
          minW={`${tap}px`}
          minH={`${tap}px`}
          onClick={handleSend}
          disabled={!input.trim() || isProcessing || disabled}
          variant="surface"
          colorPalette="blue"
          aria-label="Send message"
        >
          <MdSend size={14} />
        </IconButton>
      </Flex>

      <Flex align="center" justify="center" gap={1} px={4} pb={2.5} flexShrink={0}>
        <MdOutlineInfo size={11} color="var(--ink-tertiary)" />
        <Text fontSize="10.5px" color="var(--ink-tertiary)">
          Drafts autosave on this device only — use the manual editor or Save to store on the server.
        </Text>
      </Flex>
    </Flex>
  );
}