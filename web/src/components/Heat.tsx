interface Props {
  value: number;
  /** Hide the bar and show only the number, for tight cells. */
  compact?: boolean;
}

/**
 * The 0-100 heat score: a rank blend of volume, transactions, distinct makers and
 * buy pressure. Shown as a small meter so the eye can compare rows at a glance.
 */
export function HeatBadge({ value, compact }: Props) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const tone = clamped >= 70 ? "up" : clamped >= 40 ? undefined : "muted";

  return (
    <span className={`heat ${tone ?? ""}`} title={`Heat ${clamped}/100`}>
      {!compact && (
        <span className="heat__bar" aria-hidden="true">
          <span className="heat__fill" style={{ width: `${clamped}%` }} />
        </span>
      )}
      {clamped}
    </span>
  );
}

/** Buys vs sells as a split bar, the way screeners show buy pressure. */
export function PressureBar({ buys, sells }: { buys: number; sells: number }) {
  const total = buys + sells;
  const buyShare = total > 0 ? (buys / total) * 100 : 50;

  return (
    <div>
      <div className="row row--between small" style={{ marginBottom: 6 }}>
        <span className="up">Buys {buys}</span>
        <span className="down">Sells {sells}</span>
      </div>
      <div className="pressure" role="img" aria-label={`${Math.round(buyShare)}% buys`}>
        <span className="pressure__buy" style={{ width: `${buyShare}%` }} />
        <span className="pressure__sell" style={{ width: `${100 - buyShare}%` }} />
      </div>
    </div>
  );
}
