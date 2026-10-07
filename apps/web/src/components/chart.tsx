"use client";
function coordinates(data: number[], w: number, h: number, pad = 0) {
  const min = Math.min(...data) - 5,
    max = Math.max(...data) + 5;
  return data.map((v, i) => [
    pad + (i / (data.length - 1)) * (w - pad * 2),
    pad + (1 - (v - min) / (max - min)) * (h - pad * 2),
  ]);
}
export function Sparkline({
  data,
  negative = false,
  className = "",
}: {
  data: number[];
  negative?: boolean;
  className?: string;
}) {
  const points = coordinates(data, 110, 36, 2);
  return (
    <svg
      className={`sparkline ${negative ? "negative" : ""} ${className}`}
      viewBox="0 0 110 36"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
