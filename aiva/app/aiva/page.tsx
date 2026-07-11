import { flags } from "@/lib/flags";
import NeuralCore from "@/components/neural/NeuralCore";
import Brief from "@/components/Brief";
import AgentGrid from "@/components/AgentGrid";
import CommandBox from "@/components/CommandBox";
import { Card, SectionTitle } from "@/components/kit";

export const dynamic = "force-dynamic";

export default function CommandCenterPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="flex flex-col justify-center">
          <SectionTitle sub="Every pulse is a real business event.">AIVA Neural Core</SectionTitle>
          <NeuralCore enable3d={flags.brain3d} />
        </Card>
        <div>
          <Brief />
        </div>
      </div>

      <div>
        <SectionTitle sub="Type a command to preview a structured plan. Nothing executes in read-only mode.">
          Ask AIVA
        </SectionTitle>
        <CommandBox />
      </div>

      <div>
        <SectionTitle sub="Ten domain agents share one business data graph.">Agent network</SectionTitle>
        <AgentGrid />
      </div>
    </div>
  );
}
