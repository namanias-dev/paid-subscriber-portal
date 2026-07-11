import RevenueTowerView from "@/components/RevenueTowerView";
import AgentPanel from "@/components/AgentPanel";
import { SectionTitle } from "@/components/kit";

export const dynamic = "force-dynamic";

export default function RevenuePage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-extrabold text-white md:text-3xl">Revenue Control Tower</h1>
        <p className="text-sm text-muted">Read-only. Matches the portal Payments tab &amp; CEO Overview.</p>
      </div>
      <RevenueTowerView />
      <div>
        <SectionTitle>Revenue Agent</SectionTitle>
        <AgentPanel domain="revenue" />
      </div>
    </div>
  );
}
