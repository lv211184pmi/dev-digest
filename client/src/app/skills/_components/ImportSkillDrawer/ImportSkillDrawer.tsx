"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Drawer, FormField, SelectInput, Tabs, TextInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import {
  useCommunitySkills,
  useCreateSkill,
  useImportArchivePreview,
  useImportCommunitySkill,
} from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { deriveSkillName } from "@/lib/skill-import";
import { COMMUNITY_LANGUAGES, DRAWER_WIDTH } from "./constants";
import { s } from "./styles";

const TYPE_OPTIONS: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/**
 * Import a skill — File tab (paste/upload a `.md`, or upload a `.zip` that's
 * unpacked server-side with executables stripped) and Community tab (search
 * the static fixture catalog). URL import stays unbuilt — its contract exists
 * for a later lesson. Either path ends in a normal `POST /skills`
 * (`source: 'extracted' | 'community'`, `enabled: false` — needs vetting).
 */
export function ImportSkillDrawer({
  initialTab,
  onClose,
  onImported,
}: {
  initialTab: "file" | "community";
  onClose: () => void;
  onImported: (id: string) => void;
}) {
  const t = useTranslations("skills");
  const toast = useToast();
  const [tab, setTab] = React.useState<"file" | "community">(initialTab);

  // ---- File tab ----
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const importArchive = useImportArchivePreview();
  const createSkill = useCreateSkill();

  const onFileChosen = async (file: File) => {
    setWarnings([]);
    if (file.name.toLowerCase().endsWith(".zip")) {
      try {
        const preview = await importArchive.mutateAsync(file);
        setName(preview.name);
        setBody(preview.body);
        setType(preview.type);
        setWarnings(preview.warnings);
      } catch {
        toast.error(t("drawer.importFailed"));
      }
      return;
    }
    const text = await file.text();
    setName(deriveSkillName(text, file.name));
    setBody(text);
  };

  const importFile = async () => {
    const skill = await createSkill.mutateAsync({
      name: name.trim() || "Untitled skill",
      type,
      body,
      source: "extracted",
      enabled: false,
    });
    toast.success(t("file.success", { name: skill.name }));
    onImported(skill.id);
    onClose();
  };

  // ---- Community tab (static fixture list, no live registry) ----
  const [query, setQuery] = React.useState("");
  const [lang, setLang] = React.useState<string>("All languages");
  const {
    data: results,
    isLoading,
    isError,
    refetch,
  } = useCommunitySkills(query, lang === "All languages" ? "" : lang);
  const importCommunity = useImportCommunitySkill();

  const doImportCommunity = async (repo: string, communityName: string) => {
    const skill = await importCommunity.mutateAsync({ repo, name: communityName });
    toast.success(t("community.success", { name: skill.name }));
    onImported(skill.id);
    onClose();
  };

  const typeOptions = TYPE_OPTIONS.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  return (
    <Drawer width={DRAWER_WIDTH} title={t("drawer.title")} subtitle={t("drawer.subtitle")} onClose={onClose}>
      <Tabs
        tabs={[
          { key: "file", label: t("drawer.tabs.file"), icon: "Upload" },
          { key: "community", label: t("drawer.tabs.community"), icon: "Globe" },
        ]}
        value={tab}
        onChange={(k) => setTab(k as "file" | "community")}
        pad="0"
      />
      <div style={{ marginTop: 20 }}>
        {tab === "file" ? (
          <div style={s.body}>
            <div style={s.fileRow}>
              <input
                type="file"
                accept=".md,.zip"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFileChosen(file);
                }}
              />
              {importArchive.isPending && <span>{t("file.importing")}</span>}
            </div>
            {warnings.length > 0 && (
              <div style={s.warnings}>
                {warnings.map((w, i) => (
                  <span key={i}>{w}</span>
                ))}
              </div>
            )}
            <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
              <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
            </FormField>
            <FormField label={t("preview.typeLabel")}>
              <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
            </FormField>
            <FormField label={t("file.bodyLabel")} hint={t("file.bodyHint")}>
              <Textarea value={body} onChange={setBody} rows={10} mono placeholder={t("file.bodyPlaceholder")} />
            </FormField>
            <div style={s.footer}>
              <Button
                kind="primary"
                icon="Upload"
                onClick={importFile}
                disabled={!body.trim() || createSkill.isPending}
              >
                {createSkill.isPending ? t("file.importing") : t("file.import")}
              </Button>
            </div>
          </div>
        ) : (
          <div style={s.body}>
            <TextInput value={query} onChange={setQuery} placeholder={t("community.searchPlaceholder")} />
            <div style={s.langRow}>
              {COMMUNITY_LANGUAGES.map((l) => (
                <button key={l} type="button" style={s.langPill(lang === l)} onClick={() => setLang(l)}>
                  {l === "All languages" ? t("community.allLanguages") : l}
                </button>
              ))}
            </div>
            {isLoading && <p>{t("community.searchPlaceholder")}</p>}
            {isError && (
              <Button kind="ghost" onClick={() => refetch()}>
                {t("community.retry")}
              </Button>
            )}
            {!isLoading && !isError && (results ?? []).length === 0 && <p>{t("community.noMatch.body")}</p>}
            {(results ?? []).map((r) => (
              <div key={`${r.repo}/${r.name}`} style={s.resultCard}>
                <div style={s.resultHeader}>
                  <span className="mono" style={s.resultName}>
                    {r.name}
                  </span>
                  <span style={s.resultStars}>★ {r.stars}</span>
                </div>
                <p style={s.resultDesc}>{r.desc}</p>
                <div style={s.resultFooter}>
                  <span style={s.resultRepo}>
                    {r.repo} · {r.lang}
                  </span>
                  <Button
                    kind="secondary"
                    size="sm"
                    icon="Plus"
                    onClick={() => doImportCommunity(r.repo, r.name)}
                    disabled={importCommunity.isPending}
                  >
                    {t("community.import")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}
