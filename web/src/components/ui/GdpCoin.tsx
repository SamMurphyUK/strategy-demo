import "./GdpCoin.css";

export type GdpCoinSize = "sm" | "md" | "lg";

/** Edge length in px of each size. */
export const GDP_COIN_PX: Record<GdpCoinSize, number> = { sm: 20, md: 28, lg: 36 };

export interface GdpCoinProps {
  /** The territory's GDP. */
  value: number;
  size?: GdpCoinSize;
  className?: string;
}

/** A territory's GDP on a small brass-rimmed disc: the number and nothing else. */
export function GdpCoin({ value, size = "md", className }: GdpCoinProps) {
  const px = GDP_COIN_PX[size];
  return (
    <span
      className={["gdp-coin", `gdp-${size}`, className ?? ""].filter(Boolean).join(" ")}
      style={{ width: px, height: px }}
      role="img"
      aria-label={`GDP ${value}`}
      title={`GDP ${value}`}
    >
      <span className="gdp-coin-value">{value}</span>
    </span>
  );
}
