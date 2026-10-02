import { runAgentTurn } from "./src/harness.js";
import { MockLanguageModelV4 } from "ai/test";
const model = new MockLanguageModelV4({
  doStream: async () => ({
    stream: new ReadableStream({
      start(c) {
        c.enqueue({ type: "stream-start", warnings: [] });
        c.enqueue({ type: "text-start", id: "0" });
        c.enqueue({ type: "text-delta", id: "0", delta: "RELIANCE looks cheap." });
        c.enqueue({ type: "text-delta" } as any);
        c.close();
      },
    }),
  }),
});
const res = await runAgentTurn({ model, system: "s", prompt: "p", maxToolSteps: 1, streamRetries: 0 } as any);
console.log(JSON.stringify({ text: res.text, error: res.error }, null, 2));
