export default function Logo({
  size = 40,
  variant = "primary",
}: {
  size?: number;
  variant?: "primary" | "admin";
}) {
  const bg =
    variant === "admin"
      ? "linear-gradient(135deg,#0057FF,#3D8BFF)"
      : "linear-gradient(135deg,#0057FF,#3D8BFF)";
  return (
    <span
      className="inline-flex items-center justify-center font-heading font-extrabold"
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        background: bg,
        color: "#fff",
        fontSize: size * 0.5,
        boxShadow: "0 6px 18px rgba(0,87,255,0.30)",
      }}
    >
      N
    </span>
  );
}
