/* hooks/skills.ts — React Query hooks for the Skills Lab page + Skill detail
   pane (L02). Same shape as hooks/agents.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CommunitySkill, Skill, SkillSource, SkillType, SkillVersion } from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  source?: SkillSource;
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">> & {
    change_summary?: string;
  };
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

export function useSkillVersions(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", skillId],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${skillId}/versions`),
    enabled: !!skillId,
  });
}

export function useRestoreSkillVersion(skillId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: number) =>
      api.post<Skill>(`/skills/${skillId}/versions/${version}/restore`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

/** Agents that have this skill linked (Stats tab). */
export function useSkillAgents(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-agents", skillId],
    queryFn: () => api.get<{ id: string; name: string }[]>(`/skills/${skillId}/agents`),
    enabled: !!skillId,
  });
}

export interface SkillImportPreview {
  name: string;
  body: string;
  type: SkillType;
  warnings: string[];
}

/** Upload a .zip archive → an unpersisted preview (name/body/type prefilled
 *  for the import form). Plain .md files are parsed client-side instead —
 *  see `lib/skill-import.ts`. */
export function useImportArchivePreview() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.upload<SkillImportPreview>("/skills/import/preview", form);
    },
  });
}

export function useCommunitySkills(q: string, lang: string) {
  return useQuery({
    queryKey: ["community-skills", q, lang],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (lang) params.set("lang", lang);
      const qs = params.toString();
      return api.get<CommunitySkill[]>(`/skills/community${qs ? `?${qs}` : ""}`);
    },
  });
}

export function useImportCommunitySkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { repo: string; name: string }) =>
      api.post<Skill>("/skills/community/import", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}
