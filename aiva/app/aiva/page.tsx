import ChatDesk from "@/components/chat/ChatDesk";

export const dynamic = "force-dynamic";

/**
 * The AIVA home is now the executive chat desk — a grounded, read-only Chief of Staff. The 3D
 * JARVIS brain is preserved on the archive/jarvis-neural-brain branch + tag and removed from the
 * live app (no Three.js in the bundle). The intelligence/data layer it used lives on in the
 * assistant's data tools.
 */
export default function CommandDeskPage() {
  return <ChatDesk />;
}
