"use client";

import Modal from "@/components/ui/Modal";
import PlanCard from "@/components/ui/PlanCard";
import { PLANS } from "@/lib/config";
import type { PlanId } from "@/lib/types";

export default function RenewModal({
  open,
  onClose,
  currentPlan,
}: {
  open: boolean;
  onClose: () => void;
  currentPlan?: PlanId;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Renew / Upgrade your plan" maxWidth="max-w-3xl">
      <p className="mb-4 text-sm text-muted">
        Pick a plan to continue your UPSC journey without interruption.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {PLANS.map((p) => (
          <PlanCard key={p.id} plan={p} current={p.id === currentPlan} />
        ))}
      </div>
    </Modal>
  );
}
