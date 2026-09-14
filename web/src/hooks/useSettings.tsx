import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/** How much recent history the chain scan should try to cover. */
export type Timeframe = "15m" | "1h" | "6h";

export interface Settings {
  timeframe: Timeframe;
  /** Slippage tolerance, in percent. */
  slippage: number;
  /** Transaction deadline, in minutes. */
  deadline: number;
  /** Approve the router once for an unlimited amount instead of per trade. */
  unlimitedApproval: boolean;
  /** Show the price chart above the swap card. */
  showChart: boolean;
}

// 1h keeps the first load quick on a rate-limited public RPC while still filling
// the 5m, 15m and 1h columns.
const DEFAULTS: Settings = {
  timeframe: "1h",
  slippage: 0.5,
  deadline: 20,
  unlimitedApproval: false,
  showChart: true,
};
const STORAGE_KEY = "rho.settings";

/** Above this, the UI warns the trade may be sandwiched or badly priced. */
export const HIGH_SLIPPAGE = 5;
export const HIGH_PRICE_IMPACT = 3;
export const BLOCKING_PRICE_IMPACT = 15;

interface SettingsApi extends Settings {
  set: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsApi | undefined>(undefined);

function load(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const timeframe = parsed.timeframe;
    return {
      timeframe: timeframe === "15m" || timeframe === "1h" || timeframe === "6h" ? timeframe : DEFAULTS.timeframe,
      slippage: clamp(parsed.slippage ?? DEFAULTS.slippage, 0.01, 50),
      deadline: clamp(parsed.deadline ?? DEFAULTS.deadline, 1, 4320),
      unlimitedApproval: parsed.unlimitedApproval ?? DEFAULTS.unlimitedApproval,
      showChart: parsed.showChart ?? DEFAULTS.showChart,
    };
  } catch {
    return DEFAULTS;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);

  useEffect(() => setSettings(load()), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Private browsing: settings just will not persist.
    }
  }, [settings]);

  const set = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULTS), []);

  const value = useMemo(() => ({ ...settings, set, reset }), [reset, set, settings]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsApi {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used inside a SettingsProvider");
  return context;
}
