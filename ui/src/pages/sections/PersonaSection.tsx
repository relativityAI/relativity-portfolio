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
        title="Agent Persona"
        description="A free-form, in-depth description of who the agent is as a decision-maker — the investing beliefs, philosophy, and mindset it operates with."
        sequenceNumber={2}
      />
      <SectionBlock
        sectionId="persona"
        subsectionId="philosophy_and_mindset"
        title="Philosophy and Mindset"
        description="A paragraph about the agent's investing values and mindset – the more detailed the better."
      >
        <NarrativeField
          label=""
          description=""
          value={data.philosophy_and_mindset || ""}
          onChange={(v) => update("philosophy_and_mindset", v)}
          placeholder="Describe the agent's investing philosophy, core beliefs, risk attitude, and overall mindset..."
          minH="160px"
        />
      </SectionBlock>
    </>
  )
}
