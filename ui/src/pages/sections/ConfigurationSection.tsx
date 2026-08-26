import { Flex, SimpleGrid, Text, Slider } from "@chakra-ui/react"
import ChipMultiSelect from "../shared/ChipMultiSelect"
import SectionBlock from "../shared/SectionBlock"
import SectionHeader from "../shared/SectionHeader"

const HORIZON_OPTIONS = [
  { value: "Intraday", label: "Intraday" },
  { value: "Swing", label: "Swing" },
  { value: "Positional", label: "Positional" },
  { value: "Long-term (years)", label: "Long-term" },
]

interface ConfigurationSectionProps {
  data: {
    investment_horizon: string;
    risk_appetite: number;
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
        first
        title="Configuration"
        description="Sets the boundaries of the investing world this agent is allowed to operate in."
        sequenceNumber={1}
      />

      <SimpleGrid columns={{ base: 1, lg: 2 }} columnGap={10} alignItems="start">
        <SectionBlock
          sectionId="configuration"
          subsectionId="horizon"
          title="Investment Horizon"
          description="How long this agent typically holds positions."
        >
          <ChipMultiSelect
            label=""
            description=""
            options={HORIZON_OPTIONS}
            selected={data.investment_horizon ? [data.investment_horizon] : []}
            onChange={(v) => update("investment_horizon", v[0] || "")}
            multiple={false}
            columns={4}
          />
        </SectionBlock>

        <SectionBlock
          sectionId="configuration"
          subsectionId="risk"
          title="Risk Appetite"
          description="How much risk this agent tolerates — 1 = very conservative, 10 = aggressive."
        >
          <Flex direction="column" gap={3}>
            <Flex justify="space-between" align="center">
              <Text fontSize="sm" color="var(--ink-secondary)">
                {data.risk_appetite <= 3 ? "Conservative" : data.risk_appetite <= 6 ? "Balanced" : "Aggressive"}
              </Text>
              <Text fontSize="sm" fontWeight={600} color="var(--ink-primary)" fontFamily="var(--font-mono)">
                {data.risk_appetite || 5}
              </Text>
            </Flex>
            <Slider.Root
              min={1}
              max={10}
              step={1}
              value={[data.risk_appetite || 5]}
              onValueChange={(e) => update("risk_appetite", e.value[0])}
              size="sm"
            >
              <Slider.Control>
                <Slider.Track>
                  <Slider.Range />
                </Slider.Track>
                <Slider.Thumb index={0} />
              </Slider.Control>
            </Slider.Root>
            <Flex justify="space-between" fontSize="11px" color="var(--ink-tertiary)">
              <span>Conservative (1)</span>
              <span>Balanced (5)</span>
              <span>Aggressive (10)</span>
            </Flex>
          </Flex>
        </SectionBlock>
      </SimpleGrid>
    </>
  )
}