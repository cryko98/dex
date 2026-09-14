import { useToasts, type Toast } from "../hooks/useToasts";
import { AlertIcon, CheckIcon, CloseIcon, ExternalIcon, SpinnerIcon } from "./Icons";

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
    </div>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div className={`toast toast--${toast.kind}`}>
      <span className="toast__icon">
        {toast.kind === "pending" && <SpinnerIcon size={18} />}
        {toast.kind === "success" && <CheckIcon size={18} />}
        {toast.kind === "error" && <AlertIcon size={18} />}
        {toast.kind === "info" && <AlertIcon size={18} />}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="toast__title">{toast.title}</div>
        {toast.description && <div className="toast__desc">{toast.description}</div>}
        {toast.href && (
          <a
            className="row small"
            style={{ gap: 5, marginTop: 6 }}
            href={toast.href}
            target="_blank"
            rel="noreferrer"
          >
            View on explorer
            <ExternalIcon size={12} />
          </a>
        )}
      </div>

      <button className="btn btn--ghost btn--icon" onClick={onDismiss} aria-label="Dismiss">
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
