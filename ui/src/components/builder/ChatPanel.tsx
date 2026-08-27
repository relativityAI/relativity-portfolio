import { useState, useRef, useEffect } from "react";
import { Box, Flex, Input, IconButton, Text } from "@chakra-ui/react";
import { MdSend, MdOutlineInfo } from "react-icons/md";
import ChatBubble, { type ChatMsg } from "./ChatBubble";
import DocDropzone from "./DocDropzone";
import StepsTrace, { type BuilderStep } from "./StepsTrace";

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
      if (messages[i].role === "assistant" && messages[i].options && messages[i].options.length > 0) {
        return i;
      }
    }
    return -1;
  })();

  return (
    <Flex direction="column" h="100%">
      {/* Messages area */}
      <Box flex={1} overflowY="auto" px={4} py={4}>
        <Flex direction="column" gap={3}>
          {messages.map((msg, i) => (
            <ChatBubble
              key={msg.id}
              message={msg}
              onOptionSelect={i === lastOptionsIdx ? onOptionSelect : undefined}
              isLatest={i === lastOptionsIdx}
            />
          ))}
          {steps && steps.length > 0 && (
            <Box px={1}>
              <StepsTrace steps={steps} />
            </Box>
          )}
          <div ref={messagesEndRef} />
        </Flex>
      </Box>

      {/* Document dropzone */}
      <Box px={4} pb={2}>
        <DocDropzone
          onUpload={onUploadFiles}
          documents={documents}
          onRemove={onRemoveDocument}
          disabled={disabled}
        />
      </Box>

      {/* Input area */}
      <Flex px={4} pb={4} pt={2} gap={2} align="center">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          size="sm"
          flex={1}
          bg="var(--surface-panel)"
          border="1px solid var(--hairline)"
          borderRadius="3px"
          fontSize="13px"
          _placeholder={{ color: "var(--ink-tertiary)" }}
          _focus={{ borderColor: "var(--accent-primary)", outline: "none" }}
          disabled={isProcessing || disabled}
        />
        <IconButton
          size="sm"
          onClick={handleSend}
          disabled={!input.trim() || isProcessing || disabled}
          bg="var(--accent-primary)"
          color="#fff"
          borderRadius="3px"
          _hover={{ opacity: 0.9 }}
          aria-label="Send message"
        >
          <MdSend size={14} />
        </IconButton>
      </Flex>

      <Flex align="center" justify="center" gap={1} px={4} pb={2}>
        <MdOutlineInfo size={11} color="var(--ink-tertiary)" />
        <Text fontSize="10.5px" color="var(--ink-tertiary)">
          This chat isn't stored — it's cleared when you refresh or leave this page.
        </Text>
      </Flex>
    </Flex>
  );
}
