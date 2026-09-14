import type { CategoryStat } from "../lib/categories";
import { formatChange, formatCompactUsd } from "../lib/format";

interface Props {
  categories: CategoryStat[];
  active?: string;
  onSelect: (id: string | undefined) => void;
  /** Label for the numbers, e.g. "1h". */
  timeframe: string;
}

/**
 * The themes people are launching right now, ranked by how many live memecoins sit
 * in each. Counts and volume come from the chain index, not a curated list.
 */
export function TrendingBar({ categories, active, onSelect, timeframe }: Props) {
  // "Other" is every unmatched coin, so it would always top the bar and say nothing.
  const shown = categories.filter((category) => category.id !== "other");
  if (shown.length === 0) return null;

  return (
    <div className="trending" role="tablist" aria-label="Trending memecoin themes">
      <span className="trending__label">
        <span aria-hidden="true">🔥</span> Trending
      </span>

      {shown.map((category, index) => {
        const isActive = active === category.id;
        const tone =
          category.change === undefined ? "muted" : category.change >= 0 ? "up" : "down";

        return (
          <button
            key={category.id}
            role="tab"
            aria-selected={isActive}
            className={isActive ? "trend-chip trend-chip--active" : "trend-chip"}
            onClick={() => onSelect(isActive ? undefined : category.id)}
            title={`${category.tokens} tokens · ${formatCompactUsd(category.volumeUsd)} volume ${timeframe} · e.g. ${category.samples.join(", ")}`}
          >
            <span className="trend-chip__rank">#{index + 1}</span>
            <span aria-hidden="true">{category.emoji}</span>
            <span className="trend-chip__label">{category.label}</span>
            <span className="trend-chip__meta">{category.tokens}</span>
            <span className="trend-chip__meta">{formatCompactUsd(category.volumeUsd)}</span>
            <span className={`trend-chip__meta ${tone}`}>{formatChange(category.change)}</span>
          </button>
        );
      })}
    </div>
  );
}
