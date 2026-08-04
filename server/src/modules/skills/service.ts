import type { Container } from '../../platform/container.js';
import type { CommunitySkill, Skill, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsRepository } from './repository.js';
import { toSkillDto, toSkillVersionDto } from './helpers.js';
import {
  extractFromArchive,
  extractFromMarkdown,
  getCommunitySkillBody,
  searchCommunitySkills,
  type SkillImportPreview,
} from './import.js';

/**
 * skills module — business logic for the Skills Lab page and the Agent
 * Editor's Skills tab. A Skill = name + description + type + markdown body +
 * enabled + source. Config changes are versioned via `skill_versions`
 * (repository), same pattern as agents.
 */

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  source?: SkillSource;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  change_summary?: string;
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = container.skillsRepo;
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  /** Delete a skill (and its versions/agent-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description ?? '',
      type: input.type,
      source: input.source ?? 'manual',
      body: input.body,
      enabled: input.enabled,
    });
    return toSkillDto(row);
  }

  async update(workspaceId: string, id: string, patch: UpdateSkillInput): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.change_summary !== undefined ? { changeSummary: patch.change_summary } : {}),
    });
    return row ? toSkillDto(row) : undefined;
  }

  /** Version history for a skill, newest first. Workspace-scoped. */
  async listVersions(workspaceId: string, skillId: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    return rows.map(toSkillVersionDto);
  }

  /** A single body snapshot for a skill. */
  async getVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<SkillVersion | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(skillId, version);
    return row ? toSkillVersionDto(row) : undefined;
  }

  /** Restore an old version's body as the new current version. */
  async restoreVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<Skill | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const row = await this.repo.restoreVersion(workspaceId, skillId, version);
    return row ? toSkillDto(row) : undefined;
  }

  /** Agents linked to this skill (Stats tab: "used by N agents"). */
  async agentsForSkill(
    workspaceId: string,
    skillId: string,
  ): Promise<{ id: string; name: string }[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    return this.repo.agentsForSkill(skillId);
  }

  // ---- Import (unpersisted preview; a normal create() confirms) -----------

  previewArchive(buffer: Buffer): SkillImportPreview {
    return extractFromArchive(buffer);
  }

  previewMarkdown(text: string, filename?: string): SkillImportPreview {
    return extractFromMarkdown(text, filename);
  }

  // ---- Community (static fixture, no live registry) -----------------------

  searchCommunity(q?: string, lang?: string): CommunitySkill[] {
    return searchCommunitySkills(q, lang);
  }

  async importCommunity(workspaceId: string, repo: string, name: string): Promise<Skill> {
    const found = getCommunitySkillBody(repo, name);
    if (!found) throw new NotFoundError('Community skill not found');
    return this.create(workspaceId, {
      name: found.name,
      description: found.desc,
      type: 'custom',
      body: found.body,
      source: 'community',
      enabled: false,
    });
  }
}
