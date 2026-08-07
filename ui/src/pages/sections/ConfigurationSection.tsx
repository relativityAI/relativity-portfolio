import { Flex, Text, Box } from "@chakra-ui/react"
import { MdLock } from "react-icons/md"
import ChipMultiSelect from "../shared/ChipMultiSelect"
import SectionBlock from "../shared/SectionBlock"
import SectionHeader from "../shared/SectionHeader"

const MARKET_OPTIONS = [
  { value: "US", label: "US - SEC" },
  { value: "IN", label: "IN – NSE" },
]

const ASSET_CLASS_OPTIONS = [
  { value: "stocks", label: "Stocks" },
  { value: "mutual_funds", label: "Mutual Funds" },
]

const CAP_OPTIONS = [
  { value: "large", label: "Large" },
  { value: "mid", label: "Mid" },
  { value: "small", label: "Small" },
]

const SECTOR_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "defence", label: "Defence" },
  { value: "pharma", label: "Pharma" },
  { value: "technology", label: "Technology" },
  { value: "healthcare", label: "Healthcare" },
  { value: "financials", label: "Financials" },
  { value: "energy", label: "Energy" },
  { value: "consumer_cyclical", label: "Consumer Cyclical" },
  { value: "consumer_defensive", label: "Consumer Defensive" },
  { value: "industrials", label: "Industrials" },
  { value: "materials", label: "Materials" },
  { value: "utilities", label: "Utilities" },
  { value: "real_estate", label: "Real Estate" },
  { value: "communication", label: "Communication" },
]

interface ConfigurationSectionProps {
  data: {
    market_options: string[];
    asset_class: string[];
    universe_cap: string[];
    universe_sector: string[];
  };
  onChange: (data: any) => void;
}

export default function ConfigurationSection({ data, onChange }: ConfigurationSectionProps) {
  const update = (field: string, value: any) => {
    onChange({ ...data, [field]: value })
  }

  const handleAssetClassChange = (value: string[]) => {
    if (value.includes("mutual_funds")) {
      onChange({ ...data, asset_class: value, market_options: ["IN"] })
    } else {
      onChange({ ...data, asset_class: value })
    }
  }

  const isMF = data.asset_class?.includes("mutual_funds")

  return (
    <>
      <SectionHeader
        title="Configuration"
        description="Sets the boundaries of the investing world this agent is allowed to operate in."
        sequenceNumber={1}
      />

      <SectionBlock
        sectionId="configuration"
        subsectionId="market_options"
        title="Select Market Options"
        description="Which markets or exchanges are eligible for trading."
      >
        <Flex direction="column" gap={3}>
          {isMF ? (
            <Flex
              align="center"
              gap={2}
              px={3}
              py={2}
              bg="var(--surface-recessed)"
              border="1px solid var(--hairline)"
              borderRadius="2px"
              opacity={0.8}
              cursor="not-allowed"
            >
              <MdLock size={14} color="var(--ink-tertiary)" />
              <Text fontSize="13px" fontWeight={500} color="var(--ink-secondary)">IN – NSE</Text>
            </Flex>
          ) : (
            <ChipMultiSelect
              label=""
              description=""
              options={MARKET_OPTIONS}
              selected={data.market_options}
              onChange={(v) => update("market_options", v)}
              multiple={false}
            />
          )}
          <Text fontSize="12px" color="var(--ink-tertiary)">
            {isMF ? "India is the only market for Mutual Funds" : "Only 1 market allowed"}
          </Text>
        </Flex>
      </SectionBlock>

      <SectionBlock
        sectionId="configuration"
        subsectionId="asset_class"
        title="Asset Class"
        description="Which asset classes are in scope."
      >
        <Flex direction="column" gap={3}>
          <ChipMultiSelect
            label=""
            description=""
            options={ASSET_CLASS_OPTIONS}
            selected={data.asset_class}
            onChange={handleAssetClassChange}
            multiple={false}
          />
          <Text fontSize="12px" color="var(--ink-tertiary)">Only 1 asset class allowed</Text>
        </Flex>
      </SectionBlock>

      <Text
        fontSize="13px"
        fontWeight={600}
        color="var(--ink-primary)"
        pt={6}
        pb={3}
        letterSpacing="0.08em"
        textTransform="uppercase"
      >
        Asset Universe
      </Text>

      <SectionBlock
        sectionId="configuration"
        subsectionId="universe_cap"
        title="Capitalization Based Options"
        description="Which size segments — large, mid, small cap — are in scope."
      >
        <ChipMultiSelect
          label=""
          description=""
          options={CAP_OPTIONS}
          selected={data.universe_cap}
          onChange={(v) => update("universe_cap", v)}
        />
      </SectionBlock>

      <SectionBlock
        sectionId="configuration"
        subsectionId="universe_sector"
        title="Sector / Industry Based Options"
        description="Which sectors or industries are included."
      >
        <ChipMultiSelect
          label=""
          description=""
          options={SECTOR_OPTIONS}
          selected={data.universe_sector}
          onChange={(v) => update("universe_sector", v)}
        />
      </SectionBlock>
    </>
  )
}
