/**
 * Memecoin themes, detected from a token's name and symbol.
 *
 * Nothing on-chain says what a coin is "about", so this is keyword matching, kept
 * deliberately broad and documented so a wrong label is easy to trace. A token can
 * sit in several themes; one with no match is "Other".
 */

export interface Category {
  id: string;
  label: string;
  emoji: string;
  /** Lower-case substrings matched against name and symbol. */
  keywords: string[];
  /** Extra test for things keywords cannot express, like a script range. */
  test?: (name: string, symbol: string) => boolean;
}

const CJK = /[㐀-䶿一-鿿豈-﫿]/;

export const CATEGORIES: Category[] = [
  {
    id: "dogs",
    label: "Dogs",
    emoji: "🐶",
    keywords: ["dog", "doge", "shib", "inu", "pup", "woof", "bark", "corgi", "floki", "hound", "husky", "bonk", "wif", "paw"],
  },
  {
    id: "cats",
    label: "Cats",
    emoji: "🐱",
    keywords: ["cat", "kitty", "kitten", "meow", "neko", "purr", "nyan", "feline", "popcat", "mew"],
  },
  {
    id: "chinese",
    label: "Chinese coins",
    emoji: "🐉",
    keywords: ["china", "chinese", "panda", "dragon", "baozi", "mao", "wechat", "alipay", "jiang", "shanghai", "beijing", "hongkong", "hong kong"],
    test: (name, symbol) => CJK.test(name) || CJK.test(symbol),
  },
  {
    id: "frogs",
    label: "Frogs",
    emoji: "🐸",
    keywords: ["frog", "pepe", "toad", "ribbit", "kek", "apu", "brett", "andy"],
  },
  {
    id: "ai",
    label: "AI",
    emoji: "🤖",
    keywords: ["ai", "gpt", "agent", "neural", "robot", "bot", "llm", "openai", "claude", "grok", "anthrop"],
  },
  {
    id: "robinhood",
    label: "Robinhood",
    emoji: "🪶",
    keywords: ["hood", "robin", "feather", "vlad", "rh ", "arrow", "sherwood"],
  },
  {
    id: "politics",
    label: "Politics",
    emoji: "🗳️",
    keywords: ["trump", "maga", "biden", "kamala", "elon", "musk", "obama", "putin", "president", "vance", "doge"],
  },
  {
    id: "animals",
    label: "Other animals",
    emoji: "🦁",
    keywords: ["ape", "monkey", "bear", "bull", "duck", "bird", "penguin", "fish", "whale", "goat", "pig", "cow", "wolf", "lion", "tiger", "hippo", "chimp", "rat", "mouse", "hamster", "sloth", "owl", "shark", "snake"],
  },
  {
    id: "food",
    label: "Food",
    emoji: "🍕",
    keywords: ["pizza", "burger", "taco", "banana", "coffee", "beer", "wine", "sushi", "noodle", "rice", "cake", "donut", "bomb", "chip"],
  },
  {
    id: "space",
    label: "Moon & space",
    emoji: "🚀",
    keywords: ["moon", "mars", "rocket", "space", "star", "galaxy", "lunar", "orbit", "cosmos", "sol", "astro"],
  },
  {
    id: "finance",
    label: "Finance memes",
    emoji: "💎",
    keywords: ["diamond", "hands", "wsb", "stonk", "gme", "amc", "pump", "rich", "wealth", "money", "cash", "bank", "ponzi", "yolo", "degen", "gamble", "casino"],
  },
  {
    id: "gaming",
    label: "Gaming",
    emoji: "🎮",
    keywords: ["game", "play", "pixel", "quest", "arcade", "poke", "mario", "sonic", "nft", "meta"],
  },
];

export const OTHER_CATEGORY: Pick<Category, "id" | "label" | "emoji"> = {
  id: "other",
  label: "Other",
  emoji: "✨",
};

/** Word-boundary aware match so "ai" does not light up on "chain" or "rain". */
function hasKeyword(haystack: string, keyword: string): boolean {
  if (keyword.length <= 3) {
    const re = new RegExp(`(^|[^a-z0-9])${escape(keyword.trim())}([^a-z0-9]|$)`, "i");
    return re.test(haystack);
  }
  return haystack.includes(keyword);
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Category ids for a token; "other" when nothing matches. */
export function categorize(name: string | undefined, symbol: string): string[] {
  const text = `${name ?? ""} ${symbol}`.toLowerCase();
  const matched: string[] = [];

  for (const category of CATEGORIES) {
    if (category.test?.(name ?? "", symbol) || category.keywords.some((k) => hasKeyword(text, k))) {
      matched.push(category.id);
    }
  }

  return matched.length ? matched : [OTHER_CATEGORY.id];
}

export interface CategoryStat {
  id: string;
  label: string;
  emoji: string;
  /** Distinct tokens in the theme. */
  tokens: number;
  volumeUsd: number;
  txns: number;
  /** Volume-weighted price change across the theme's tokens. */
  change?: number;
  /** A few symbols to show as examples. */
  samples: string[];
}

interface Categorizable {
  symbol: string;
  categories: string[];
  volumeUsd: number;
  txns: number;
  change?: number;
}

/**
 * Ranks themes by how many tokens they hold, with volume as the tie-break, so the
 * bar reads as "what people are launching right now".
 */
export function rankCategories(tokens: Categorizable[]): CategoryStat[] {
  const stats = new Map<string, CategoryStat & { weighted: number; weight: number }>();

  const definitions = [...CATEGORIES, OTHER_CATEGORY];
  for (const def of definitions) {
    stats.set(def.id, {
      id: def.id,
      label: def.label,
      emoji: def.emoji,
      tokens: 0,
      volumeUsd: 0,
      txns: 0,
      samples: [],
      weighted: 0,
      weight: 0,
    });
  }

  for (const token of tokens) {
    for (const id of token.categories) {
      const entry = stats.get(id);
      if (!entry) continue;
      entry.tokens += 1;
      entry.volumeUsd += token.volumeUsd;
      entry.txns += token.txns;
      if (entry.samples.length < 4) entry.samples.push(token.symbol);
      if (token.change !== undefined && token.volumeUsd > 0) {
        entry.weighted += token.change * token.volumeUsd;
        entry.weight += token.volumeUsd;
      }
    }
  }

  return [...stats.values()]
    .filter((entry) => entry.tokens > 0)
    .map(({ weighted, weight, ...rest }) => ({
      ...rest,
      change: weight > 0 ? weighted / weight : undefined,
    }))
    .sort((a, b) => b.tokens - a.tokens || b.volumeUsd - a.volumeUsd);
}

export function categoryById(id: string): Pick<Category, "id" | "label" | "emoji"> {
  return CATEGORIES.find((c) => c.id === id) ?? OTHER_CATEGORY;
}
