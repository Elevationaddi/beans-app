"use client";
import { citySchema, type BranchHours, type MerchantBranch } from "@beans/contracts";
import { Button, Checkbox, SelectField, TextField, useI18n } from "@beans/web";
import { useState } from "react";

export interface BranchDraft {
  nameEn: string;
  nameAr: string;
  address: string;
  lat: string;
  lng: string;
  phone: string;
  city: string;
  modes: ("in_store" | "curbside" | "dine_in")[];
  capacity: string;
  hours: BranchHours[];
}

export function draftFrom(b?: MerchantBranch): BranchDraft {
  return {
    nameEn: b?.nameEn ?? "",
    nameAr: b?.nameAr ?? "",
    address: b?.address ?? "",
    lat: b?.lat?.toString() ?? "",
    lng: b?.lng?.toString() ?? "",
    phone: b?.phone ?? "",
    city: b?.city ?? "abu_dhabi",
    modes: b?.modes ?? ["in_store"],
    capacity: String(b?.capacity ?? 10),
    hours:
      b?.hours ??
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens: "07:00", closes: "22:00" })),
  };
}

export function bodyFrom(d: BranchDraft) {
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    nameEn: d.nameEn.trim(),
    nameAr: d.nameAr.trim() || null,
    address: d.address.trim(),
    lat: num(d.lat),
    lng: num(d.lng),
    phone: d.phone.trim() || null,
    city: d.city || null,
    modes: d.modes,
    capacity: Number(d.capacity),
    hours: d.hours,
  };
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

export function BranchFields({
  draft,
  onChange,
  errors,
}: {
  draft: BranchDraft;
  onChange: (d: BranchDraft) => void;
  errors: Record<string, string[]>;
}) {
  const { t } = useI18n();
  const set = (k: keyof BranchDraft) => (e: { target: { value: string } }) =>
    onChange({ ...draft, [k]: e.target.value });
  const toggleMode = (m: BranchDraft["modes"][number], on: boolean) =>
    onChange({
      ...draft,
      modes: on ? [...new Set([...draft.modes, m])] : draft.modes.filter((x) => x !== m),
    });
  return (
    <>
      <div className="grid-2">
        <TextField
          label={t("branch.nameEn")}
          value={draft.nameEn}
          onChange={set("nameEn")}
          error={errors["nameEn"]}
          required
        />
        <TextField
          label={t("branch.nameAr")}
          value={draft.nameAr}
          onChange={set("nameAr")}
          error={errors["nameAr"]}
          dir="rtl"
          hint={t("branch.arHint")}
        />
        <TextField
          label={t("branch.address")}
          value={draft.address}
          onChange={set("address")}
          error={errors["address"]}
          required
        />
        <SelectField
          label={t("branch.city")}
          value={draft.city}
          onChange={set("city")}
          options={citySchema.options.map((c) => ({ value: c, label: t(`city.${c}`) }))}
        />
        <TextField
          label={t("branch.lat")}
          inputMode="decimal"
          value={draft.lat}
          onChange={set("lat")}
          error={errors["lat"]}
        />
        <TextField
          label={t("branch.lng")}
          inputMode="decimal"
          value={draft.lng}
          onChange={set("lng")}
          error={errors["lng"]}
        />
        <TextField
          label={t("branch.phone")}
          type="tel"
          value={draft.phone}
          onChange={set("phone")}
          error={errors["phone"]}
        />
        <TextField
          label={t("branch.capacity")}
          type="number"
          min={0}
          max={1000}
          value={draft.capacity}
          onChange={set("capacity")}
          error={errors["capacity"]}
          hint={t("branch.capacityHint")}
        />
      </div>
      <fieldset className="field">
        <legend>{t("branch.modes")}</legend>
        <div className="row">
          {(["in_store", "curbside", "dine_in"] as const).map((m) => (
            <Checkbox
              key={m}
              label={t(`mode.${m}`)}
              checked={draft.modes.includes(m)}
              onChange={(on) => toggleMode(m, on)}
            />
          ))}
        </div>
        {errors["modes"] ? <p className="field-error">{errors["modes"].join(" ")}</p> : null}
      </fieldset>
      <HoursEditor
        hours={draft.hours}
        onChange={(hours) => onChange({ ...draft, hours })}
        error={errors["hours"]}
      />
    </>
  );
}

export function HoursEditor({
  hours,
  onChange,
  error,
}: {
  hours: BranchHours[];
  onChange: (h: BranchHours[]) => void;
  error?: string[] | undefined;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const update = (i: number, patch: Partial<BranchHours>) =>
    onChange(hours.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  return (
    <fieldset className="field">
      <legend>
        {t("branch.hours")}{" "}
        <button type="button" className="link" onClick={() => setOpen((v) => !v)}>
          {open ? t("common.close") : t("common.details")}
        </button>
      </legend>
      <p className="hint">{t("branch.hoursHint")}</p>
      {open ? (
        <div className="stack">
          {hours.map((h, i) => (
            <div className="hours-grid" key={`${h.weekday}-${i}`}>
              <select
                className="input"
                aria-label={t("branch.weekday")}
                value={h.weekday}
                onChange={(e) => update(i, { weekday: Number(e.target.value) })}
              >
                {WEEKDAYS.map((d) => (
                  <option key={d} value={d}>
                    {t(`weekday.${d}`)}
                  </option>
                ))}
              </select>
              <input
                className="input"
                type="time"
                aria-label={t("branch.opens")}
                value={h.opens}
                onChange={(e) => update(i, { opens: e.target.value })}
              />
              <input
                className="input"
                type="time"
                aria-label={t("branch.closes")}
                value={h.closes}
                onChange={(e) => update(i, { closes: e.target.value })}
              />
              <Button variant="ghost" onClick={() => onChange(hours.filter((_, idx) => idx !== i))}>
                {t("common.remove")}
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              onClick={() => onChange([...hours, { weekday: 1, opens: "07:00", closes: "12:00" }])}
            >
              {t("branch.addHours")}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="field-error">{error.join(" ")}</p> : null}
    </fieldset>
  );
}
