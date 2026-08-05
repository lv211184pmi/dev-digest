"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, Textarea, TextInput, Toggle } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useConventionSkillDraft, useCreateConventionSkill } from "@/lib/hooks/conventions";
import { estimateTokens } from "@/lib/skill-import";
import { useToast } from "@/lib/toast";
import { MODAL_WIDTH, TYPE_OPTIONS } from "./constants";
import { s } from "./styles";

/**
 * The modal *is* the vetting step for an extracted skill — Enabled defaults
 * ON (see root INSIGHTS.md's "enabled:true deviation") because there is no
 * path to a saved skill here a human hasn't read and could still edit.
 * Fields are seeded from the server-rendered draft, then are legitimately
 * local state (a draft, not server state) until Create.
 */
export function CreateConventionSkillModal({
  runId,
  repoId,
  onClose,
}: {
  runId: string;
  repoId: string;
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const common = useTranslations("common");
  const toast = useToast();
  const { data: draft, isLoading } = useConventionSkillDraft(runId);
  const create = useCreateConventionSkill(repoId, runId);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("convention");
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState("");

  React.useEffect(() => {
    if (!draft) return;
    setName(draft.name);
    setDescription(draft.description);
    setType(draft.type);
    setEnabled(draft.enabled);
    setBody(draft.body);
  }, [draft]);

  const submit = async () => {
    await create.mutateAsync({
      name: name.trim() || draft?.name || "conventions",
      description,
      type,
      enabled,
      body,
    });
    toast.success(t("toolbar.skillCreated"));
    onClose();
  };

  const typeOptions = TYPE_OPTIONS.map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }));
  const filename = `${(name || draft?.name || "conventions").toLowerCase().replace(/\s+/g, "-")}.md`;

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("modal.title")}
      subtitle={draft?.name}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {common("actions.cancel")}
          </Button>
          <Button kind="primary" icon="Sparkles" onClick={submit} disabled={create.isPending || isLoading}>
            {create.isPending ? t("modal.creating") : t("modal.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <p style={s.banner}>{t("modal.banner")}</p>

        <FormField label={t("modal.nameLabel")} required>
          <TextInput value={name} onChange={setName} />
        </FormField>

        <FormField label={t("modal.descriptionLabel")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>

        <div style={s.row}>
          <div style={s.rowItem}>
            <FormField label={t("modal.typeLabel")}>
              <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
            </FormField>
          </div>
          <div style={s.rowItem}>
            <FormField label={t("modal.enabledLabel")} hint={t("modal.enabledHint")}>
              <div style={s.enabledLabel}>
                <Toggle on={enabled} onChange={setEnabled} size={16} />
              </div>
            </FormField>
          </div>
        </div>

        <FormField label={t("modal.bodyLabel")}>
          <div style={s.filenameBar}>
            <span className="mono">{filename}</span>
            <span style={{ marginLeft: "auto" }}>{t("modal.tokenCount", { count: estimateTokens(body) })}</span>
          </div>
          <Textarea value={body} onChange={setBody} rows={16} mono />
        </FormField>

        <p style={s.footerNote}>{t("modal.footerNote")}</p>
      </div>
    </Modal>
  );
}
