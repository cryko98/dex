import { useEffect, useRef, useState } from "react";

import { HIGH_SLIPPAGE, useSettings } from "../hooks/useSettings";
import { SettingsIcon } from "./Icons";

const SLIPPAGE_PRESETS = [0.1, 0.5, 1];

/** Slippage, deadline and approval preferences, in a popover off the gear button. */
export function SettingsMenu() {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isCustomSlippage = !SLIPPAGE_PRESETS.includes(settings.slippage);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        className="btn btn--ghost btn--icon"
        onClick={() => setOpen((value) => !value)}
        aria-label="Transaction settings"
        aria-expanded={open}
      >
        <SettingsIcon size={18} />
      </button>

      {open && (
        <div className="popover">
          <div className="popover__group">
            <div className="popover__label">
              <span>Slippage tolerance</span>
              <button className="btn btn--ghost btn--sm" onClick={settings.reset} style={{ padding: "2px 8px" }}>
                Reset
              </button>
            </div>
            <div className="chips">
              {SLIPPAGE_PRESETS.map((value) => (
                <button
                  key={value}
                  className={settings.slippage === value ? "chip chip--active" : "chip"}
                  onClick={() => settings.set({ slippage: value })}
                >
                  {value}%
                </button>
              ))}
              <div className="input-inline" style={isCustomSlippage ? { borderColor: "var(--lime)" } : undefined}>
                <input
                  inputMode="decimal"
                  value={isCustomSlippage ? settings.slippage : ""}
                  placeholder="Custom"
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 50) settings.set({ slippage: parsed });
                  }}
                />
                <span className="faint small">%</span>
              </div>
            </div>
            {settings.slippage >= HIGH_SLIPPAGE && (
              <div className="banner banner--warn" style={{ marginTop: 10 }}>
                High slippage means your trade can execute at a much worse price.
              </div>
            )}
          </div>

          <div className="popover__group">
            <div className="popover__label">
              <span>Transaction deadline</span>
              <div className="input-inline">
                <input
                  inputMode="numeric"
                  value={settings.deadline}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 4320) settings.set({ deadline: parsed });
                  }}
                />
                <span className="faint small">min</span>
              </div>
            </div>
          </div>

          <div className="popover__group">
            <button className="toggle" onClick={() => settings.set({ unlimitedApproval: !settings.unlimitedApproval })}>
              <span>
                Unlimited approvals
                <div className="faint" style={{ fontSize: 11 }}>
                  Approve once instead of every trade
                </div>
              </span>
              <span className={settings.unlimitedApproval ? "toggle__track toggle__track--on" : "toggle__track"}>
                <span className="toggle__thumb" />
              </span>
            </button>
          </div>

          <div className="popover__group">
            <button className="toggle" onClick={() => settings.set({ showChart: !settings.showChart })}>
              <span>Show price chart</span>
              <span className={settings.showChart ? "toggle__track toggle__track--on" : "toggle__track"}>
                <span className="toggle__thumb" />
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
