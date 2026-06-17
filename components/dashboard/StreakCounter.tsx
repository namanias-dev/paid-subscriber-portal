export default function StreakCounter({ count }: { count: number }) {
  return (
    <span className="pill" style={{ background: "rgba(241,196,15,0.12)", color: "#ffd54a", border: "1px solid rgba(241,196,15,0.35)" }}>
      🔥 {count}-day streak
    </span>
  );
}
