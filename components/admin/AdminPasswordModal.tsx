"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export default function AdminPasswordModal({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (next.length < 8) return toast("New password must be at least 8 characters.", "error");
    if (next !== confirm) return toast("Passwords do not match.", "error");
    setBusy(true);
    const res = await fetch("/api/admin/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: current, new_password: next }),
    });
    const d = await res.json().catch(() => ({ ok: false }));
    setBusy(false);
    if (d.ok) {
      toast("Password updated", "success");
      setCurrent(""); setNext(""); setConfirm("");
      onChanged();
    } else toast(d.error || "Failed", "error");
  }

  return (
    <Modal open={open} onClose={onClose} title="Change your password">
      <div className="space-y-3">
        <input type="password" className="input" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input type="password" className="input" placeholder="New password (min 8 chars)" value={next} onChange={(e) => setNext(e.target.value)} />
        <input type="password" className="input" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button onClick={submit} disabled={busy} className="btn btn-primary w-full">{busy ? "Saving…" : "Update password"}</button>
      </div>
    </Modal>
  );
}
