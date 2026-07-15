/**
 * Registry of EVERY public lead-capture entry point on the portal, the endpoint
 * it submits to, and the `source_form` its `lead_created` event carries. This is
 * the single documented source for the "does every form become a CRM lead?"
 * audit — kept in sync by a test (see tests/journey-automation/lead-capture.test.ts)
 * so a new form or a renamed source_form can't silently drift.
 *
 * PURE + client-safe. Nothing here sends or executes.
 */
import { LEAD_SOURCE_FORMS } from "./leadSources";

export interface LeadCapturePath {
  /** Human name of the form/entry point. */
  form: string;
  /** The component that renders the form. */
  component: string;
  /** The API endpoint it POSTs to. */
  endpoint: string;
  /** The source_form stamped on the lead_created event. */
  sourceForm: string;
  /** Whether the path creates a first-class row in the `leads` CRM table. */
  createsCrmLead: true;
}

export const LEAD_CAPTURE_PATHS: LeadCapturePath[] = [
  { form: "Home page pop-up", component: "components/public/LeadPopup.tsx", endpoint: "/api/public/lead", sourceForm: "lead_popup", createsCrmLead: true },
  { form: "Website inline lead form", component: "components/public/LeadForm.tsx", endpoint: "/api/public/lead", sourceForm: "public_lead_form", createsCrmLead: true },
  { form: "Enrolment / checkout intent", component: "components/public/EnrollClient.tsx", endpoint: "/api/public/lead", sourceForm: "enroll_intent", createsCrmLead: true },
  { form: "Quiz sign-up gate", component: "components/public/quiz/PublicQuizAttempt.tsx", endpoint: "/api/public/quiz/lead", sourceForm: "quiz", createsCrmLead: true },
  { form: "Webinar registration", component: "components/public/WebinarRegister.tsx", endpoint: "/api/public/webinar-register", sourceForm: "webinar_registration", createsCrmLead: true },
  { form: "Resources → Open Downloads gate", component: "components/public/resources/DownloadLeadGateModal.tsx", endpoint: "/api/public/downloads/lead", sourceForm: "free_download", createsCrmLead: true },
  { form: "Admin manual add", component: "app/admin/leads/page.tsx", endpoint: "/api/admin/leads", sourceForm: "admin_manual", createsCrmLead: true },
];

/** Every source_form used by a capture path must be a registered lead source. */
export function unregisteredCaptureSourceForms(): string[] {
  const known = new Set(LEAD_SOURCE_FORMS.map((s) => s.value));
  return LEAD_CAPTURE_PATHS.map((p) => p.sourceForm).filter((s) => !known.has(s));
}
