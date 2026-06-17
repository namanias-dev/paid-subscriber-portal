export default function Logo({
  size = 40,
  variant = "gold",
}: {
  size?: number;
  variant?: "gold" | "red";
}) {
  const bg =
    variant === "red"
      ? "linear-gradient(135deg,#e74c3c,#ff7a6b)"
      : "linear-gradient(135deg,#c9a84c,#e8c96a)";
  return (
    <span
      className="inline-flex items-center justify-center font-heading font-extrabold"
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        background: bg,
        color: "#0a1628",
        fontSize: size * 0.55,
        boxShadow: "0 4px 14px rgba(201,168,76,0.3)",
      }}
    >
      {variant === "red" ? "A" : "N"}
    </span>
  );
}
