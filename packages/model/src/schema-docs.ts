/**
 * What keeps a document's docs current: its contract (the pages it must
 * have, its readers, the checks every save enforces), the artifacts it
 * keeps and never draws, and the evidence that ties each box and each
 * section to the files it came from and the commit it was checked against.
 */
import { z } from 'zod';

/** What a document is about: a system (often a repository), a standard an estate follows, or a concept. */
export const DOC_KINDS = ['system', 'standard', 'concept'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** Checks a contract can make every save enforce. */
export const DOCS_CHECKS = ['no-copied-facts', 'sections-name-boxes', 'name-every-box', 'evidence'] as const;
export type DocsCheck = (typeof DOCS_CHECKS)[number];

/** Where artifacts live in a document's folder; a file there is kept and never drawn. */
export const ARTIFACT_DIR = 'artifacts/';

/** `github.com/owner/name`: a host and a path, no scheme and no `.git`. */
export const REPOSITORY = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/[A-Za-z0-9_.-]+){2,}$/;

export const DocsSchema = z
  .object({
    kind: z.enum(DOC_KINDS).optional().describe('What the document is about: system, standard, or concept'),
    repository: z.string().regex(REPOSITORY, 'a repository is host/owner/name, such as github.com/acme/shop').optional().describe('The repository the document describes, as host/owner/name'),
    audience: z.string().optional().describe('Who the pages are written for'),
    pages: z.array(z.string().min(1)).optional().describe('Doc views the document must have; a missing one is an error every save refuses'),
    checks: z.array(z.enum(DOCS_CHECKS)).optional().describe('Page checks every save enforces as errors'),
    rules: z.array(z.string().min(1)).optional().describe('What the pages must do that no check can read, in words, for the writer'),
  })
  .strict();

export const ArtifactSchema = z
  .object({
    file: z.string().min(1).describe('Path of the file under artifacts/, relative to the document'),
    title: z.string().optional(),
    about: z.string().optional().describe('What it is and who writes it'),
  })
  .strict();

export const EvidenceSchema = z
  .object({
    to: z.string().min(1).describe('A box id, a view id, or a page section as view#anchor'),
    files: z.array(z.string().min(1)).min(1).describe('Repository paths it came from: a file, or a folder ending in /'),
    commit: z.string().regex(/^[0-9a-f]{7,40}$/, 'a commit is 7 to 40 hex characters').describe('The commit the files were read at'),
  })
  .strict();

export type DocsContract = z.output<typeof DocsSchema>;
export type Artifact = z.output<typeof ArtifactSchema>;
export type EvidenceTie = z.output<typeof EvidenceSchema>;
