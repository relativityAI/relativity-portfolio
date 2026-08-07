import { Flex, Text, Box } from "@chakra-ui/react"

interface NavItem {
  id: string;
  label: string;
  sequenceNumber?: number;
  subsections?: { id: string; label: string; children?: { id: string; label: string }[] }[];
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "configuration",
    label: "Configuration",
    sequenceNumber: 1,
    subsections: [
      { id: "market_options", label: "Market Options" },
      { id: "asset_class", label: "Asset Class" },
      { id: "asset_universe", label: "Asset Universe", children: [
        { id: "universe_cap", label: "Capitalization" },
        { id: "universe_sector", label: "Sector / Industry" },
      ]},
    ],
  },
  {
    id: "persona",
    label: "Agent Persona",
    sequenceNumber: 2,
    subsections: [
      { id: "philosophy_and_mindset", label: "Philosophy & Mindset" },
    ],
  },
  {
    id: "asset_evaluation",
    label: "Asset Evaluation",
    sequenceNumber: 3,
    subsections: [
      { id: "qualitative", label: "Qualitative" },
      { id: "quantitative", label: "Quantitative" },
    ],
  },
  {
    id: "macro_evaluation",
    label: "Macro Evaluation",
    sequenceNumber: 4,
    subsections: [
      { id: "qualitative", label: "Qualitative" },
      { id: "quantitative", label: "Quantitative" },
    ],
  },
]

function getFirstChildId(item: NavItem): string | null {
  if (item.subsections && item.subsections.length > 0) {
    const first = item.subsections[0]
    if (first.children && first.children.length > 0) return first.children[0].id
    return first.id
  }
  return null
}

function subKey(section: string, ...rest: string[]) {
  return [section, ...rest].join("/")
}

function CompletionDot({ filled }: { filled: boolean }) {
  return (
    <Box
      w="6px"
      h="6px"
      borderRadius="1px"
      bg={filled ? "var(--ink-primary)" : "transparent"}
      border={filled ? "none" : "1px solid var(--hairline"}
      flexShrink={0}
    />
  )
}

interface AgentSidebarNavProps {
  visibleSection: string;
  visibleSubsection: string | null;
  onScrollTo: (section: string, subsection?: string | null) => void;
  sectionCompletion: Record<string, boolean>;
  subsectionCompletion: Record<string, boolean>;
  isMobile?: boolean;
}

export function DesktopSidebar({ visibleSection, visibleSubsection, onScrollTo, sectionCompletion, subsectionCompletion }: AgentSidebarNavProps) {
  return (
    <Flex
      direction="column"
      gap={0.5}
      w="260px"
      flexShrink={0}
      position="sticky"
      top="140px"
      alignSelf="flex-start"
      maxH="calc(100vh - 340px)"
      overflowY="auto"
    >
      <NavRow
        label="Overview"
        isActive={visibleSection === "overview"}
        onClick={() => onScrollTo("overview")}
      />

      <Box h={3} />

      {NAV_ITEMS.map((item) => {
        const firstChild = getFirstChildId(item)
        const isSectionActive = visibleSection === item.id
        const hasContent = sectionCompletion[item.id] || false

        return (
          <Flex key={item.id} direction="column">
            <NavRow
              label={item.label}
              sequenceNumber={item.sequenceNumber}
              isActive={isSectionActive && !visibleSubsection}
              onClick={() => {
                if (item.subsections) {
                  onScrollTo(item.id, firstChild)
                } else {
                  onScrollTo(item.id)
                }
              }}
              rightElement={<CompletionDot filled={hasContent} />}
            />
            {item.subsections && (
              <Flex direction="column" ml={0}>
                {item.subsections.map((sub) => {
                  if (sub.children) {
                    const groupFilled = sub.children.some((c) => subsectionCompletion[subKey(item.id, c.id)])
                    return (
                      <Flex key={sub.id} direction="column">
                        <NavRow
                          label={sub.label}
                          isActive={isSectionActive && visibleSubsection === sub.id}
                          onClick={() => {
                            if (sub.children && sub.children.length > 0) {
                              onScrollTo(item.id, sub.children[0].id)
                            } else {
                              onScrollTo(item.id, sub.id)
                            }
                          }}
                          pl={6}
                          fontSize="xs"
                          rightElement={<CompletionDot filled={groupFilled} />}
                        />
                        {sub.children.map((child) => (
                          <NavRow
                            key={child.id}
                            label={child.label}
                            isActive={isSectionActive && visibleSubsection === child.id}
                            onClick={() => onScrollTo(item.id, child.id)}
                            pl={9}
                            fontSize="2xs"
                            rightElement={<CompletionDot filled={subsectionCompletion[subKey(item.id, child.id)] || false} />}
                          />
                        ))}
                      </Flex>
                    )
                  }
                  return (
                    <NavRow
                      key={sub.id}
                      label={sub.label}
                      isActive={isSectionActive && visibleSubsection === sub.id}
                      onClick={() => onScrollTo(item.id, sub.id)}
                      pl={6}
                      fontSize="xs"
                      rightElement={<CompletionDot filled={subsectionCompletion[subKey(item.id, sub.id)] || false} />}
                    />
                  )
                })}
              </Flex>
            )}
          </Flex>
        )
      })}
    </Flex>
  )
}

function NavRow({ label, sequenceNumber, isActive, onClick, rightElement, pl, fontSize }: {
  label: string;
  sequenceNumber?: number;
  isActive: boolean;
  onClick: () => void;
  rightElement?: React.ReactNode;
  pl?: number;
  fontSize?: string;
}) {
  return (
    <Flex
      align="center"
      justify="space-between"
      px={3}
      py={2}
      rounded="sm"
      cursor="pointer"
      borderLeft={isActive ? "2px solid var(--accent-primary)" : "2px solid transparent"}
      bg="transparent"
      color={isActive ? "var(--ink-primary)" : "var(--ink-secondary)"}
      _hover={{ bg: "var(--surface-recessed)" }}
      onClick={onClick}
      pl={pl}
      transition="background 80ms"
      fontSize={fontSize || "sm"}
      fontWeight={isActive ? 600 : 400}
    >
      <Text truncate>
        {sequenceNumber != null && (
          <Text
            as="span"
            fontFamily="var(--font-mono)"
            color="var(--ink-tertiary)"
            mr={1.5}
            fontSize="inherit"
          >
            {String(sequenceNumber).padStart(2, "0")}
          </Text>
        )}
        {label}
      </Text>
      {rightElement && <Box ml={2}>{rightElement}</Box>}
    </Flex>
  )
}

export function MobilePills({ visibleSection, visibleSubsection, onScrollTo }: AgentSidebarNavProps) {
  return (
    <Flex direction="column" gap={2} overflow="hidden">
      <Flex gap={1} overflowX="auto" flexWrap="nowrap" pb={2} css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}>
        <Pill
          label="Overview"
          isActive={visibleSection === "overview"}
          onClick={() => onScrollTo("overview")}
        />
        {NAV_ITEMS.map((item) => {
          const firstChild = getFirstChildId(item)
          return (
            <Pill
              key={item.id}
              label={item.label}
              sequenceNumber={item.sequenceNumber}
              isActive={visibleSection === item.id}
              onClick={() => {
                if (item.subsections) {
                  onScrollTo(item.id, firstChild)
                } else {
                  onScrollTo(item.id)
                }
              }}
            />
          )
        })}
      </Flex>

      {(() => {
        const current = NAV_ITEMS.find((i) => i.id === visibleSection)
        if (!current?.subsections) return null
        return (
          <Flex gap={1} overflowX="auto" flexWrap="nowrap" css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}>
            {current.subsections.map((sub) => {
              if (sub.children) {
                return sub.children.map((child) => (
                  <Pill
                    key={child.id}
                    label={child.label}
                    isActive={visibleSubsection === child.id}
                    onClick={() => onScrollTo(current.id, child.id)}
                    size="xs"
                  />
                ))
              }
              return (
                <Pill
                  key={sub.id}
                  label={sub.label}
                  isActive={visibleSubsection === sub.id}
                  onClick={() => onScrollTo(current.id, sub.id)}
                  size="xs"
                />
              )
            })}
          </Flex>
        )
      })()}
    </Flex>
  )
}

function Pill({ label, sequenceNumber, isActive, onClick, size }: {
  label: string;
  sequenceNumber?: number;
  isActive: boolean;
  onClick: () => void;
  size?: string;
}) {
  return (
    <Box
      px={3}
      py={1.5}
      rounded="2px"
      whiteSpace="nowrap"
      cursor="pointer"
      bg="transparent"
      color={isActive ? "var(--ink-primary)" : "var(--ink-tertiary)"}
      border="1px solid"
      borderColor={isActive ? "var(--accent-primary)" : "var(--hairline)"}
      _hover={{ bg: "var(--surface-recessed)" }}
      onClick={onClick}
      fontSize={size || "sm"}
      fontWeight={isActive ? 500 : 400}
      transition="background 80ms"
    >
      {sequenceNumber != null && (
        <Text
          as="span"
          fontFamily="var(--font-mono)"
          mr={1}
          fontSize="inherit"
          color="var(--ink-tertiary)"
        >
          {String(sequenceNumber).padStart(2, "0")}
        </Text>
      )}
      {label}
    </Box>
  )
}
