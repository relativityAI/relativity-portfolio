import { Flex, Text, SimpleGrid } from "@chakra-ui/react"
import ChipMultiSelect from "../shared/ChipMultiSelect"
import SectionBlock from "../shared/SectionBlock"
import SectionHeader from "../shared/SectionHeader"

const ASSET_CLASS_OPTIONS = [
  { value: "stocks", label: "Stocks" },
  { value: "mutual_funds", label: "Mutual Funds" },
]

const CAP_OPTIONS = [
  { value: "large", label: "Large" },
  { value: "mid", label: "Mid" },
  { value: "small", label: "Small" },
]

interface ConfigurationSectionProps {
  data: {
    asset_class: string[];
    universe_cap: string[];
  };
  onChange: (data: any) => void;
}

export default function ConfigurationSection({ data, onChange }: ConfigurationSectionProps) {
  const update = (field: string, value: any) => {
    onChange({ ...data, [field]: value })
  }

  return (
    <>
      <SectionHeader
        title="Configuration"
        description="Sets the boundaries of the investing world this agent is allowed to operate in."
        sequenceNumber={1}
      />

      <SimpleGrid columns={{ base: 1, lg: 2 }} columnGap={10} alignItems="start">
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
              onChange={(v) => update("asset_class", v)}
              multiple={false}
              columns={2}
            />
            <Text fontSize="12px" color="var(--ink-tertiary)">Only 1 asset class allowed</Text>
          </Flex>
        </SectionBlock>

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
            columns={2}
          />
        </SectionBlock>
      </SimpleGrid>
    </>
  )
}
