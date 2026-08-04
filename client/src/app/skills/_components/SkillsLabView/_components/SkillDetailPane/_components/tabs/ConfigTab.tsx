"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, SelectInput, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { estimateTokens } from "@/lib/skill-import";
import { s } from "./styles";

const TYPE_OPTIONS: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Config tab — name/description/type/body + enabled toggle. Saving bumps the
 *  skill's version and snapshots the body (with an optional change-summary
 *  note) into skill_versions. */
export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);
  const [changeSummary, setChangeSummary] = React.useState("");

  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setEnabled(skill.enabled);
    setChangeSummary("");
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const configDirty =
    name !== skill.name || description !== skill.description || type !== skill.type || body !== skill.body;
  const dirty = configDirty || enabled !== skill.enabled;

  const typeOptions = TYPE_OPTIONS.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const save = () =>
    update.mutate(
      {
        id: skill.id,
        patch: {
          name,
          description,
          type,
          body,
          enabled,
          ...(changeSummary.trim() ? { change_summary: changeSummary.trim() } : {}),
        },
      },
      {
        onSuccess: (data) => {
          toast.success(t("preview.saved", { version: data.version }));
          setChangeSummary("");
        },
      },
    );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("detail.tabs.config")}</h2>
        <label style={s.enabledLabel}>
          {t("preview.enabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>
      <FormField label={t("preview.nameLabel")} required>
        <TextInput value={name} onChange={setName} />
      </FormField>
      <FormField label={t("preview.descriptionLabel")} hint={t("preview.descriptionHint")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label={t("preview.typeLabel")}>
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
      </FormField>
      <FormField label={t("preview.bodyLabel")} hint={t("preview.bodyHint")}>
        <div style={s.filenameBar}>
          <span className="mono">{name || skill.name}.md</span>
          {configDirty && <span>· unsaved</span>}
          <span style={{ marginLeft: "auto" }}>{t("preview.tokenCount", { count: estimateTokens(body) })}</span>
        </div>
        <Textarea value={body} onChange={setBody} rows={16} mono />
      </FormField>
      {configDirty && (
        <FormField label={t("preview.changeSummaryLabel")}>
          <TextInput
            value={changeSummary}
            onChange={setChangeSummary}
            placeholder={t("preview.changeSummaryPlaceholder")}
          />
        </FormField>
      )}
      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending || !dirty}>
          {update.isPending ? t("preview.saving") : t("preview.save")}
        </Button>
      </div>
    </div>
  );
}
