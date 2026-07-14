import NarrativeField from "../shared/NarrativeField"
import SectionBlock from "../shared/SectionBlock"
import SectionHeader from "../shared/SectionHeader"

interface PersonaSectionProps {
  data: {
    philosophy_and_mindset: string;
  };
  onChange: (data: any) => void;
}

export default function PersonaSection({ data, onChange }: PersonaSectionProps) {
  const update = (field: string, value: string) => {
    onChange({ ...data, [field]: value })
  }

  return (
    <>
      <SectionHeader
        title="Investor Persona"
        description="A free-form, in-depth description of who the investor is as a decision-maker — their beliefs, philosophy, and mindset."
        sequenceNumber={2}
      />
      <SectionBlock
        sectionId="persona"
        subsectionId="philosophy_and_mindset"
        title="Philosophy and Mindset"
        description="A paragraph about the investor's values and mindset – the more detailed the better."
      >
        <NarrativeField
          label=""
          description=""
          value={data.philosophy_and_mindset || ""}
          onChange={(v) => update("philosophy_and_mindset", v)}
          placeholder="Describe your investing philosophy, core beliefs, risk attitude, and overall mindset..."
          minH="160px"
        />
      </SectionBlock>
    </>
  )
}
