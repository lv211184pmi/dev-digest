"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { DEFAULT_TYPE, MODAL_WIDTH, TYPE_OPTIONS } from "./constants";
import { s } from "./styles";

/** Create-skill modal — name/description/type/body, mirrors CreateAgentModal. */
export function CreateSkillModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations("skills");
  const common = useTranslations("common");
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_TYPE);
  const [body, setBody] = React.useState("# Rule\n\nDescribe the rule…\n");

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim() || "New Skill",
      description,
      type,
      body,
      source: "manual",
    });
    onClose();
    onCreated(skill.id);
  };

  const typeOptions = TYPE_OPTIONS.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("page.createFromScratch")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {common("actions.cancel")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={create.isPending}>
            {create.isPending ? t("page.creating") : t("page.createFromScratch")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("preview.nameLabel")} required>
          <TextInput value={name} onChange={setName} placeholder="pr-quality-rubric" />
        </FormField>
        <FormField label={t("preview.descriptionLabel")} hint={t("preview.descriptionHint")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>
        <FormField label={t("preview.typeLabel")}>
          <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
        </FormField>
        <FormField label={t("preview.bodyLabel")}>
          <Textarea value={body} onChange={setBody} rows={8} mono />
        </FormField>
      </div>
    </Modal>
  );
}
