import { useState, useEffect, useCallback, useRef } from "react";
import { Box, Flex, Text, Button, Input } from "@chakra-ui/react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";
import { BuilderService, AgentService, VoyagerService, AnalysisService, SettingsService } from "@/db";
import ChatPanel from "@/components/builder/ChatPanel";
import AgentPreviewPanel from "@/components/builder/AgentPreviewPanel";
import type { ChatMsg } from "@/components/builder/ChatBubble";
import { MdSave, MdOutlineEdit } from "react-icons/md";

const DEFAULT_AGENT = {
  name: "",
  persona: { philosophy_and_mindset: "" },
  configuration: { investment_horizon: "", risk_appetite: 5 },
  asset_evaluation: { qualitative: [], quantitative: [] },
  macro_evaluation: { qualitative: [], quantitative: [] },
};

let msgId = 0;
function nextMsgId() {
  return `msg-${++msgId}-${Date.now()}`;
}

interface DocFile {
  filename: string;
  char_count: number;
  status: "uploading" | "processing" | "done" | "error";
  error?: string;
}

export default function AgentBuilder() {
  const { id: urlAgentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [agentDraft, setAgentDraft] = useState<Record<string, unknown>>({ ...DEFAULT_AGENT });
  const [isDirty, setIsDirty] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [documents, setDocuments] = useState<DocFile[]>([]);
  const [documentTexts, setDocumentTexts] = useState<{ filename: string; text: string }[]>([]);
  const [metrics, setMetrics] = useState<{ id: string; name: string; type: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(urlAgentId || null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const draftRef = useRef(agentDraft);
  draftRef.current = agentDraft;
  const processingRef = useRef(false);
  const savingRef = useRef(false);

  // Fetch metrics + available models + load existing agent on mount
  useEffect(() => {
    VoyagerService.getAvailableMetrics("NSE").then((data) => {
      if (data?.fields) setMetrics(data.fields);
    }).catch(() => {});

    Promise.all([
      AnalysisService.getAvailableModels(),
      SettingsService.getSettings().catch(() => ({ llm_keys: {} })),
    ]).then(([modelsData, settings]) => {
      const allModels = Array.isArray(modelsData) ? modelsData : [];
      const keys = Object.keys(settings?.llm_keys || {});
      const models = keys.length > 0
        ? allModels.filter((m: string) => {
            const provider = m.split("/")[0];
            return provider === "ollama" || keys.includes(provider);
          })
        : allModels;
      setAvailableModels(models);
      setSelectedModel((prev) => {
        if (prev && models.includes(prev)) return prev;
        return models[0] || "";
      });
    }).catch(() => {});

    // If URL has an agent ID, load it into the builder
    if (urlAgentId) {
      AgentService.readAgent(urlAgentId).then((agent) => {
        setAgentDraft(agent);
        setAgentId(agent.id || agent._id);
        setInitialized(true);
        setMessages([{
          id: nextMsgId(),
          role: "assistant",
          content: `Loaded "${agent.name || "Untitled"}". What would you like to change?`,
          options: [
            { id: "refine", label: "I want to adjust something", description: "Tweak philosophy, criteria, or configuration" },
            { id: "more_docs", label: "Upload documents to refine", description: "Upload research docs to improve the agent" },
          ],
          timestamp: Date.now(),
        }]);
      }).catch(() => {
        setInitialized(true);
        setMessages([{
          id: nextMsgId(),
          role: "assistant",
          content: "Couldn't load that agent. Starting fresh.",
          timestamp: Date.now(),
        }]);
      });
    }
  }, [urlAgentId]);

  // Initial greeting from builder (only if not loading existing agent)
  useEffect(() => {
    if (initialized) return;
    setInitialized(true);
    BuilderService.getPresets().then((presets) => {
      const options = presets.map((p: { key: string; name: string; description: string }) => ({
        id: p.key,
        label: p.name,
        description: p.description,
      }));
      setMessages([{
        id: nextMsgId(),
        role: "assistant",
        content: "What kind of investment agent are you building?",
        options: [...options, { id: "custom", label: "Custom / I'll describe it", description: "Start from scratch with your own philosophy" }],
        timestamp: Date.now(),
      }]);
    }).catch(() => {
      setMessages([{
        id: nextMsgId(),
        role: "assistant",
        content: "What kind of investment agent are you building? Describe your investment style, or choose a preset.",
        timestamp: Date.now(),
      }]);
    });
  }, [initialized]);

  const callBuilder = useCallback(async (userResponse: string, messagesSnapshot: ChatMsg[]) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);
    try {
      const response = await BuilderService.draft({
        messages: messagesSnapshot.map((m) => ({ role: m.role, content: m.content })),
        agent_draft: draftRef.current,
        metrics,
        document_texts: documentTexts,
        user_response: userResponse,
        model_id: selectedModel || undefined,
      });

      const assistantMsg: ChatMsg = {
        id: nextMsgId(),
        role: "assistant",
        content: response.message,
        options: response.options,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      if (response.agent_draft_update) {
        setAgentDraft((prev) => {
          const next = { ...prev };
          for (const [key, val] of Object.entries(response.agent_draft_update!)) {
            if (typeof val === "object" && val !== null && !Array.isArray(val) && typeof prev[key] === "object" && prev[key] !== null) {
              next[key] = { ...prev[key], ...val };
            } else {
              next[key] = val;
            }
          }
          return next;
        });
        setIsDirty(true);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      const msg = axiosErr?.response?.data?.error || (err instanceof Error ? err.message : String(err));
      console.error("[Builder]", msg, err);
      setMessages((prev) => [...prev, {
        id: nextMsgId(),
        role: "assistant",
        content: `Something went wrong: ${msg.slice(0, 300)}. Please try again.`,
        timestamp: Date.now(),
      }]);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [metrics, documentTexts, selectedModel]);

  const handleSendMessage = useCallback((text: string) => {
    const userMsg: ChatMsg = {
      id: nextMsgId(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => {
      const next = [...prev, userMsg];
      setTimeout(() => callBuilder(text, next), 0);
      return next;
    });
  }, [callBuilder]);

  const handleSave = useCallback(async () => {
    if (savingRef.current) return;
    if (!agentDraft.name?.trim()) {
      setMessages((prev) => [...prev, {
        id: nextMsgId(),
        role: "assistant",
        content: "Give your agent a name before saving. What should it be called?",
        timestamp: Date.now(),
      }]);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      if (agentId) {
        await AgentService.updateAgent({ ...agentDraft, id: agentId, _id: agentId });
      } else {
        const created = await AgentService.createAgent(agentDraft.name);
        const newId = created.id || created._id;
        await AgentService.updateAgent({ ...agentDraft, id: newId, _id: newId });
        setAgentId(newId);
      }
      setIsDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Builder save]", msg);
      setMessages((prev) => [...prev, {
        id: nextMsgId(),
        role: "assistant",
        content: `Failed to save: ${msg.slice(0, 150)}. Please try again.`,
        timestamp: Date.now(),
      }]);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [agentDraft, agentId]);

  const handleOptionSelect = useCallback((option: { id: string; label: string; description?: string }) => {
    const userMsg: ChatMsg = {
      id: nextMsgId(),
      role: "user",
      content: option.label,
      timestamp: Date.now(),
    };

    // "save" option from conversation
    if (option.id === "save") {
      setMessages((prev) => [...prev, userMsg]);
      setTimeout(() => handleSave(), 0);
      return;
    }

    // "refine" option
    if (option.id === "refine") {
      setMessages((prev) => [...prev, userMsg, {
        id: nextMsgId(),
        role: "assistant",
        content: "What would you like to change? You can say things like:\n- \"Change the philosophy to focus on growth\"\n- \"Increase risk to 7\"\n- \"Add a rule for ROE > 20%\"\n- \"Remove macro evaluation\"",
        timestamp: Date.now(),
      }]);
      return;
    }

    // If it's a preset, fetch and apply it
    if (option.id !== "custom" && option.id !== "more_docs") {
      setMessages((prev) => {
        const next = [...prev, userMsg];
        setTimeout(async () => {
          setIsProcessing(true);
          try {
            const [preset, signals] = await Promise.all([
              BuilderService.getPreset(option.id),
              documentTexts.length > 0 ? BuilderService.extractSignals(documentTexts) : null,
            ]);

            let merged = { ...preset };
            if (signals && signals.philosophy) {
              merged = {
                ...merged,
                persona: { philosophy_and_mindset: signals.philosophy || preset.persona.philosophy_and_mindset },
                configuration: {
                  investment_horizon: signals.horizon || preset.configuration.investment_horizon,
                  risk_appetite: signals.risk || preset.configuration.risk_appetite,
                },
              };
              if (signals.qualitative_params?.length) {
                merged.asset_evaluation = {
                  ...merged.asset_evaluation,
                  qualitative: signals.qualitative_params,
                };
              }
              if (signals.quantitative_rules?.length) {
                merged.asset_evaluation = {
                  ...merged.asset_evaluation,
                  quantitative: signals.quantitative_rules,
                };
              }
            }

            setAgentDraft((prev) => ({ ...prev, ...merged, name: merged.name || option.label }));
            setIsDirty(true);

            const summary = `I've set up a "${merged.name}" agent.\n\n` +
              `Philosophy: ${merged.persona.philosophy_and_mindset.slice(0, 150)}...\n\n` +
              `Configuration: ${merged.configuration.investment_horizon}, Risk ${merged.configuration.risk_appetite}/10\n\n` +
              `Asset Evaluation: ${merged.asset_evaluation.qualitative.length} qualitative, ${merged.asset_evaluation.quantitative.length} quantitative rules\n\n` +
              `Macro Evaluation: ${merged.macro_evaluation.qualitative.length} qualitative, ${merged.macro_evaluation.quantitative.length} quantitative rules\n\n` +
              `Looks good, or want to adjust something?`;

            setMessages((prev) => [...prev, {
              id: nextMsgId(),
              role: "assistant",
              content: summary,
              options: [
                { id: "save", label: "Looks good, save it", description: "Save the agent with these settings" },
                { id: "refine", label: "I want to adjust something", description: "Tweak philosophy, criteria, or configuration" },
                { id: "more_docs", label: "Upload more documents", description: "Add additional documents to refine the agent" },
              ],
              timestamp: Date.now(),
            }]);
          } catch {
            setMessages((prev) => [...prev, {
              id: nextMsgId(),
              role: "assistant",
              content: "I've set up a basic agent. Describe what you'd like to change, or upload documents to refine it.",
              timestamp: Date.now(),
            }]);
          } finally {
            setIsProcessing(false);
          }
        }, 0);
        return next;
      });
      return;
    }

    // Custom path or more_docs — forward to LLM
    setMessages((prev) => {
      const next = [...prev, userMsg];
      setTimeout(() => callBuilder(option.label, next), 0);
      return next;
    });
  }, [callBuilder, documentTexts, handleSave]);

  const handleUploadFiles = useCallback(async (files: File[]) => {
    const newDocs: DocFile[] = files.map((f) => ({
      filename: f.name,
      char_count: 0,
      status: "uploading" as const,
    }));
    setDocuments((prev) => [...prev, ...newDocs]);

    try {
      const result = await BuilderService.uploadDocuments(files);

      setDocuments((prev) => {
        const updated = [...prev];
        result.documents.forEach((doc, i) => {
          const idx = updated.length - files.length + i;
          if (idx >= 0 && idx < updated.length) {
            updated[idx] = { filename: doc.filename, char_count: doc.char_count, status: "processing" };
          }
        });
        return updated;
      });

      const newDocTexts = result.documents.map((d) => ({ filename: d.filename, text: d.text }));
      setDocumentTexts((prev) => [...prev, ...newDocTexts]);

      setMessages((prev) => [...prev, {
        id: nextMsgId(),
        role: "assistant",
        content: `Processing ${result.documents.length} document(s): ${result.documents.map((d) => d.filename).join(", ")}...`,
        timestamp: Date.now(),
      }]);
      setIsProcessing(true);

      try {
        const signals = await BuilderService.extractSignals(newDocTexts);

        setDocuments((prev) => {
          const updated = [...prev];
          result.documents.forEach((doc, i) => {
            const idx = updated.length - files.length + i;
            if (idx >= 0 && idx < updated.length) {
              updated[idx] = { ...updated[idx], status: "done" };
            }
          });
          return updated;
        });

        let summary = `From your document(s), I detected:\n`;
        if (signals.style && signals.style !== "custom") summary += `- Investment style: ${signals.style}\n`;
        if (signals.philosophy) summary += `- Philosophy: ${signals.philosophy.slice(0, 200)}${signals.philosophy.length > 200 ? "..." : ""}\n`;
        if (signals.horizon) summary += `- Horizon: ${signals.horizon}\n`;
        if (signals.risk) summary += `- Risk: ${signals.risk}/10\n`;
        if (signals.qualitative_params?.length) summary += `- ${signals.qualitative_params.length} qualitative parameters detected\n`;
        if (signals.quantitative_rules?.length) summary += `- ${signals.quantitative_rules.length} quantitative rules detected\n`;

        if (!signals.philosophy && !signals.qualitative_params?.length && !signals.quantitative_rules?.length) {
          setMessages((prev) => [...prev, {
            id: nextMsgId(),
            role: "assistant",
            content: `I received the document(s) but couldn't extract specific investment criteria. You can describe what you'd like me to pull from them, or ask me to build an agent based on their content.`,
            timestamp: Date.now(),
          }]);
        } else {
          setAgentDraft((prev) => {
            const next = { ...prev };
            if (signals.philosophy) {
              next.persona = { ...(next.persona as Record<string, unknown>), philosophy_and_mindset: signals.philosophy };
            }
            if (signals.horizon || signals.risk) {
              next.configuration = {
                ...(next.configuration as Record<string, unknown>),
                investment_horizon: signals.horizon || (prev.configuration as Record<string, unknown>)?.investment_horizon || "",
                risk_appetite: signals.risk || (prev.configuration as Record<string, unknown>)?.risk_appetite || 5,
              };
            }
            if (signals.qualitative_params?.length) {
              next.asset_evaluation = {
                ...(next.asset_evaluation as Record<string, unknown>),
                qualitative: signals.qualitative_params,
              };
            }
            if (signals.quantitative_rules?.length) {
              next.asset_evaluation = {
                ...(next.asset_evaluation as Record<string, unknown>),
                quantitative: signals.quantitative_rules,
              };
            }
            return next;
          });
          setIsDirty(true);

          setMessages((prev) => [...prev, {
            id: nextMsgId(),
            role: "assistant",
            content: summary + "\n\nI've applied these settings to your agent. Want to adjust anything?",
            options: [
              { id: "save", label: "Looks good, save it", description: "Save the agent with these settings" },
              { id: "refine", label: "I want to adjust something", description: "Tweak philosophy, criteria, or configuration" },
              { id: "more_docs", label: "Upload more documents", description: "Add additional documents to refine the agent" },
            ],
            timestamp: Date.now(),
          }]);
        }
      } catch {
        setDocuments((prev) => {
          const updated = [...prev];
          result.documents.forEach((doc, i) => {
            const idx = updated.length - files.length + i;
            if (idx >= 0 && idx < updated.length) {
              updated[idx] = { ...updated[idx], status: "done" };
            }
          });
          return updated;
        });
        setMessages((prev) => [...prev, {
          id: nextMsgId(),
          role: "assistant",
          content: `Received ${result.documents.length} document(s): ${result.documents.map((d) => d.filename).join(", ")}. Describe what you'd like me to extract, or ask me to build an agent from their content.`,
          timestamp: Date.now(),
        }]);
      } finally {
        setIsProcessing(false);
      }
    } catch {
      setDocuments((prev) => {
        const updated = [...prev];
        for (let i = updated.length - files.length; i < updated.length; i++) {
          if (i >= 0) updated[i] = { ...updated[i], status: "error", error: "Upload failed" };
        }
        return updated;
      });
    }
  }, []);

  const handleRemoveDocument = useCallback((index: number) => {
    setDocuments((prev) => prev.filter((_, i) => i !== index));
    setDocumentTexts((prev) => prev.filter((_, i) => i !== index));
    setIsDirty(true);
  }, []);

  const handleOpenManual = useCallback(() => {
    if (agentId) {
      navigate(`/agent/${agentId}`);
    } else {
      navigate("/agent/new");
    }
  }, [agentId, navigate]);

  return (
    <Box bg="var(--surface-canvas)" h="100%" overflow="hidden" display="flex" flexDirection="column">
      {/* Header */}
      <Flex
        align="center"
        justify="space-between"
        px={{ base: 4, md: 8 }}
        py={3}
        borderBottom="1px solid var(--hairline)"
        bg="var(--surface-panel)"
        flexShrink={0}
        gap={4}
      >
        <Flex align="center" gap={4} minW={0} flex={1}>
          <Flex direction="column" minW={0}>
            <Text fontSize="16px" fontWeight={600} color="var(--ink-primary)" whiteSpace="nowrap">
              Agent Builder
            </Text>
            <Text fontSize="11px" color="var(--ink-tertiary)" whiteSpace="nowrap">
              Use our Agent Builder to create your research agent — configured to your needs
            </Text>
          </Flex>
          <Input
            value={(agentDraft.name as string) || ""}
            onChange={(e) => {
              setAgentDraft((prev) => ({ ...prev, name: e.target.value }));
              setIsDirty(true);
            }}
            placeholder="Agent name..."
            size="sm"
            maxW="240px"
            bg="var(--surface-recessed)"
            border="1px solid var(--hairline)"
            borderRadius="3px"
            fontSize="13px"
            fontWeight={500}
            _placeholder={{ color: "var(--ink-tertiary)" }}
            _focus={{ borderColor: "var(--accent-primary)", outline: "none" }}
          />
        </Flex>

        <Flex align="center" gap={3} flexShrink={0}>
          {/* Model selector */}
          {availableModels.length > 0 && (
            <Flex align="center" gap={1.5}>
              <Text fontSize="11px" color="var(--ink-tertiary)" whiteSpace="nowrap">Model</Text>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                style={{
                  fontSize: "12px",
                  padding: "4px 24px 4px 8px",
                  borderRadius: "3px",
                  border: "1px solid var(--hairline)",
                  background: "var(--surface-panel)",
                  color: "var(--ink-primary)",
                  cursor: "pointer",
                  appearance: "none",
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 6px center",
                  maxWidth: "200px",
                }}
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Flex>
          )}

          <AnimatePresence mode="wait">
            {isDirty ? (
              <Flex as={motion.div} key="dirty" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: dur.fast, ease }} align="center" gap={1.5}>
                <motion.span
                  animate={{ scale: [1, 1.25, 1] }}
                  transition={{ repeat: Infinity, repeatDelay: 1.6, duration: dur.slow }}
                  style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--signal-caution)", display: "inline-block" }}
                />
                <Text as="span" fontSize="12px" color="var(--signal-caution)" fontWeight={500} display={{ base: "none", md: "inline" }}>
                  Unsaved
                </Text>
              </Flex>
            ) : saved ? (
              <Flex as={motion.div} key="saved" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: dur.fast, ease }} align="center" gap={1.5}>
                <Box w="7px" h="7px" borderRadius="50%" bg="var(--signal-positive)" />
                <Text as="span" fontSize="12px" color="var(--ink-tertiary)" display={{ base: "none", md: "inline" }}>
                  Saved
                </Text>
              </Flex>
            ) : null}
          </AnimatePresence>

          <Button
            size="xs"
            variant="ghost"
            color="var(--ink-secondary)"
            onClick={handleOpenManual}
            fontSize="12px"
          >
            <MdOutlineEdit size={13} />
            Manual Editor
          </Button>

          <Button
            as={motion.button}
            animate={isDirty ? {
              boxShadow: [
                "0 0 0 0 rgba(91, 127, 222, 0)",
                "0 0 0 4px rgba(91, 127, 222, 0.3)",
                "0 0 0 0 rgba(91, 127, 222, 0)",
              ],
            } : { boxShadow: "0 0 0 0 rgba(91, 127, 222, 0)" }}
            transition={isDirty ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : {}}
            whileTap={{ scale: 0.97 }}
            size="sm"
            bg="var(--accent-primary)"
            color="#fff"
            fontWeight={500}
            fontSize="13px"
            px={5}
            _hover={{ opacity: 0.92 }}
            borderRadius="3px"
            loading={saving}
            onClick={handleSave}
          >
            <MdSave size={14} />
            {agentId ? "Save" : "Create Agent"}
          </Button>
        </Flex>
      </Flex>

      {/* Two-column layout */}
      <Flex flex={1} overflow="hidden" px={{ base: 0, md: 0 }}>
        {/* Chat panel */}
        <Box flex={1} borderRight="1px solid var(--hairline)" overflow="hidden">
          <ChatPanel
            messages={messages}
            onSendMessage={handleSendMessage}
            onOptionSelect={handleOptionSelect}
            onUploadFiles={handleUploadFiles}
            documents={documents}
            onRemoveDocument={handleRemoveDocument}
            isProcessing={isProcessing}
          />
        </Box>

        {/* Preview panel */}
        <Box w="380px" minW="300px" display={{ base: "none", lg: "block" }} p={4} bg="var(--surface-panel)" overflow="hidden">
          <AgentPreviewPanel agentDraft={agentDraft} isDirty={isDirty} />
        </Box>
      </Flex>
    </Box>
  );
}
