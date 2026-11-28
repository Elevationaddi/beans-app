"use client";
import { brand } from "@beans/ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import type { ApiError } from "./api";
import { useI18n } from "./i18n";

/** CSS variables generated from the central brand file, so a rebrand touches one file. */
export function BrandStyle() {
  const c = brand.colors;
  const css = `:root{--c-bg:${c.background};--c-surface:${c.surface};--c-ink:${c.ink};--c-primary:${c.primary};--c-accent:${c.accent};--c-success:${c.success};--c-warning:${c.warning};--c-error:${c.error};--c-border:${c.border};--f-latin:${brand.fonts.latin};--f-arabic:${brand.fonts.arabic};}`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

export function Logo({ surface }: { surface: keyof typeof brand.surfaces }) {
  const { locale } = useI18n();
  return (
    <span className="logo">
      <span className="logo-mark" aria-hidden="true">
        {brand.monogram}
      </span>
      <span className="logo-text">
        <strong>{brand.name[locale]}</strong>
        <small>{brand.surfaces[surface][locale]}</small>
      </span>
    </span>
  );
}

type Variant = "primary" | "secondary" | "destructive" | "ghost";

export function Button({
  variant = "primary",
  loading,
  children,
  size,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
  size?: "lg";
}) {
  return (
    <button
      type="button"
      {...rest}
      className={`btn btn-${variant}${size === "lg" ? " btn-lg" : ""} ${rest.className ?? ""}`}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  id,
}: {
  label: string;
  hint?: string | undefined;
  error?: string[] | string | undefined;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }) => ReactNode;
  id?: string;
}) {
  const auto = useId();
  const fieldId = id ?? auto;
  const errors = typeof error === "string" ? [error] : (error ?? []);
  const describedBy = [hint ? `${fieldId}-hint` : null, errors.length ? `${fieldId}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      {children({
        id: fieldId,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(errors.length ? { "aria-invalid": true } : {}),
      })}
      {hint ? (
        <p className="hint" id={`${fieldId}-hint`}>
          {hint}
        </p>
      ) : null}
      {errors.length ? (
        <p className="field-error" id={`${fieldId}-error`} role="alert">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string | undefined;
  error?: string[] | string | undefined;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(props) => <input className="input" {...input} {...props} />}
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  error,
  ...input
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string | undefined;
  error?: string[] | string | undefined;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(props) => <textarea className="input" rows={4} {...input} {...props} />}
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  options,
  ...select
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string | undefined;
  error?: string[] | string | undefined;
  options: { value: string; label: string }[];
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(props) => (
        <select className="input" {...select} {...props}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
      <span>{label}</span>
    </label>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className ?? ""}`}>
      {title || actions ? (
        <header className="card-head">
          {title ? <h2>{title}</h2> : <span />}
          {actions ? <div className="row">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}

export type Tone = "neutral" | "success" | "warning" | "error" | "info";

export function StatusChip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Loading({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="skeleton" />
      <span className="skeleton short" />
      <span className="sr-only">{label ?? t("common.loading")}</span>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title?: string;
  body?: string;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="empty" role="status">
      <p className="empty-title">{title ?? t("common.empty")}</p>
      {body ? <p className="muted">{body}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const { t } = useI18n();
  const message =
    error.status === 403
      ? t("common.forbidden")
      : error.status === 404
        ? t("common.notFound")
        : error.offline
          ? t("common.offline")
          : error.message || t("common.error");
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      {error.requestId ? (
        <p className="muted small">{t("common.requestId", { id: error.requestId })}</p>
      ) : null}
      {onRetry && error.status !== 403 ? (
        <Button variant="secondary" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  );
}

/** Loading, error, empty and success states for any query, in one place. */
export function QueryView<T>({
  query,
  empty,
  children,
}: {
  query: {
    data: T | undefined;
    error: ApiError | null;
    loading: boolean;
    stale?: boolean;
    reload: () => void;
  };
  empty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  const { t } = useI18n();
  if (query.data === undefined) {
    if (query.error) return <ErrorState error={query.error} onRetry={query.reload} />;
    return <Loading />;
  }
  return (
    <>
      {query.stale ? (
        <Banner tone="warning">
          {t("common.stale")}{" "}
          <button className="link" onClick={query.reload}>
            {t("common.retry")}
          </button>
        </Banner>
      ) : null}
      {empty && empty(query.data) ? <EmptyState /> : children(query.data)}
    </>
  );
}

export function Banner({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function ActionError({ error }: { error: ApiError | null }) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <Banner tone="error">
      {error.offline ? t("common.offline") : error.message}
      {error.requestId ? (
        <span className="muted small"> · {t("common.requestId", { id: error.requestId })}</span>
      ) : null}
    </Banner>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  caption,
  emptyText,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  caption: string;
  emptyText?: string;
}) {
  if (rows.length === 0) return <EmptyState title={emptyText} />;
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.className}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? "clickable" : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
            >
              {columns.map((c) => (
                <td key={c.key} className={c.className} data-label={c.header}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LoadMore({
  hasMore,
  loading,
  onMore,
}: {
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
}) {
  const { t } = useI18n();
  if (!hasMore) return null;
  return (
    <div className="load-more">
      <Button variant="secondary" loading={loading} onClick={onMore}>
        {t("common.loadMore")}
      </Button>
    </div>
  );
}

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute("disabled"));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`dialog${wide ? " dialog-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
            ×
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer ? <footer className="dialog-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

/** Confirmation for irreversible or money-moving actions, with an optional required reason. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  destructive,
  requireReason,
  reasonLabel,
  onConfirm,
  onClose,
  pending,
  error,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  pending?: boolean;
  error?: ApiError | null;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            loading={pending}
            disabled={requireReason && reason.trim().length < 3}
            onClick={() => onConfirm(reason.trim())}
            data-testid="confirm-action"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body}
      {requireReason ? (
        <TextArea
          label={reasonLabel ?? "Reason"}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          data-testid="confirm-reason"
        />
      ) : null}
      <ActionError error={error ?? null} />
    </Dialog>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={tab.value === value}
          className={`tab${tab.value === value ? " active" : ""}`}
          onClick={() => onChange(tab.value)}
          data-testid={`tab-${tab.value}`}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="tab-count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {hint ? <p className="muted small">{hint}</p> : null}
    </div>
  );
}

export function DefinitionList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="dl">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A simple accessible bar chart with a table fallback for screen readers (docs/09). */
export function BarChart({
  rows,
  label,
  format,
}: {
  rows: { label: string; value: number }[];
  label: string;
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const fmt = format ?? ((n: number) => String(n));
  if (rows.length === 0) return <EmptyState />;
  return (
    <figure className="bar-chart">
      <figcaption className="sr-only">{label}</figcaption>
      <div aria-hidden="true" className="bars">
        {rows.map((r) => (
          <div key={r.label} className="bar-row">
            <span className="bar-label">{r.label}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
            <span className="bar-value">{fmt(r.value)}</span>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{fmt(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}
const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: Tone = "success") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, text, tone }]);
    window.setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast toast-${i.tone}`} role="status">
            {i.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="lang" role="group" aria-label={t("common.language")}>
      <button
        className={locale === "en" ? "active" : ""}
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
        lang="en"
      >
        English
      </button>
      <button
        className={locale === "ar" ? "active" : ""}
        aria-pressed={locale === "ar"}
        onClick={() => setLocale("ar")}
        lang="ar"
        data-testid="lang-ar"
      >
        العربية
      </button>
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="filter-bar">{children}</div>;
}
