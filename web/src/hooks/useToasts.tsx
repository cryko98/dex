import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type ToastKind = "pending" | "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
  href?: string;
  /** Pending toasts stay until replaced or dismissed. */
  sticky?: boolean;
}

interface ToastApi {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => number;
  update: (id: number, toast: Partial<Omit<Toast, "id">>) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

const AUTO_DISMISS_MS = 7000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const scheduleDismiss = useCallback(
    (id: number, sticky?: boolean) => {
      if (sticky) return;
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((current) => [...current, { ...toast, id }]);
      scheduleDismiss(id, toast.sticky);
      return id;
    },
    [scheduleDismiss],
  );

  const update = useCallback(
    (id: number, patch: Partial<Omit<Toast, "id">>) => {
      setToasts((current) => current.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      if (patch.sticky === false || patch.kind === "success" || patch.kind === "error") {
        scheduleDismiss(id, false);
      }
    },
    [scheduleDismiss],
  );

  const value = useMemo(() => ({ toasts, push, update, dismiss }), [dismiss, push, toasts, update]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToasts(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToasts must be used inside a ToastProvider");
  return context;
}
