export default function AshokaChakra({
  size = 320,
  className = "",
  opacity = 0.06,
}: {
  size?: number;
  className?: string;
  opacity?: number;
}) {
  const spokes = Array.from({ length: 24 });
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`animate-spin-slow ${className}`}
      style={{ opacity }}
      aria-hidden
    >
      <circle cx="50" cy="50" r="46" fill="none" stroke="#0057FF" strokeWidth="1.2" />
      <circle cx="50" cy="50" r="6" fill="#0057FF" />
      {spokes.map((_, i) => {
        const a = (i * 360) / 24;
        return (
          <line
            key={i}
            x1="50"
            y1="50"
            x2="50"
            y2="6"
            stroke="#0057FF"
            strokeWidth="0.8"
            transform={`rotate(${a} 50 50)`}
          />
        );
      })}
    </svg>
  );
}
