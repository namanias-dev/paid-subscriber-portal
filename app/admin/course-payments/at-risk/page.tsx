"use client";

import { PageHeader } from "@/components/admin/ui";
import PeopleTabs from "@/components/admin/people/PeopleTabs";
import CollectionsWorklist from "@/components/admin/collections/CollectionsWorklist";

export default function FeesAtRiskAdmin() {
  return (
    <div>
      <PageHeader
        title="Fees at Risk (Collections)"
        subtitle="Collections lens — overdue course-fee EMIs to chase (IST). Display & navigation only; record payments from a student's profile."
      />
      <PeopleTabs active="risk" />
      <CollectionsWorklist />
    </div>
  );
}
