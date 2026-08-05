/**
 * Disposable portal accounts for installment-proof popup QA (State A / State B).
 * Never join grandfather_notice_queue or armed SMS cohorts.
 */
export const QA_INSTALLMENT_PROOF_MARKER = "DISPOSABLE_QA_INSTALLMENT_PROOF_POPUP";

export const QA_INSTALLMENT_PROOF_STUDENTS = {
  qa_expiring: {
    key: "qa_expiring" as const,
    phone: "9898900101",
    name: "Popup QA Expiring",
    /** State A: live allowed, instalment due in ~5 days. */
    state: "expiring" as const,
  },
  qa_blocked: {
    key: "qa_blocked" as const,
    phone: "9898900102",
    name: "Popup QA Blocked",
    /** State B: live playback blocked (grace ended). */
    state: "blocked" as const,
  },
} as const;

export const QA_INSTALLMENT_PROOF_PHONE_LIST: string[] = Object.values(QA_INSTALLMENT_PROOF_STUDENTS).map(
  (s) => s.phone,
);

export const QA_INSTALLMENT_PROOF_COURSE_ID = "co-safalta";
