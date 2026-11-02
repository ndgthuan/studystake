import { keccak256, toBytes } from 'viem';
import { z } from 'zod';
import { canonical_json } from './canonical.ts';

export type Hex = `0x${string}`;

export const activity_schema = z.strictObject({
  kind: z.enum(['quiz', 'assign']),
  instance_id: z.number().int().positive(),
  name: z.string().min(1).max(200),
  due: z.number().int().nonnegative(),
});

export const metadata_schema = z.strictObject({
  version: z.literal(1),
  title: z.string().min(1).max(200),
  lms: z.enum(['moodle', 'demo']),
  site: z.string().min(1).max(200),
  course_id: z.number().int().nonnegative(),
  activities: z.array(activity_schema).min(1).max(20),
  min_grade: z.number().nullable(),
});

export type ChallengeMetadata = z.infer<typeof metadata_schema>;

/** Validates an untrusted metadata document. Throws ZodError on failure. */
export function parse_metadata(raw: unknown): ChallengeMetadata {
  return metadata_schema.parse(raw);
}

/** metadata_hash = keccak256(utf8(canonical_json(doc))). */
export function metadata_hash(doc: unknown): Hex {
  return keccak256(toBytes(canonical_json(doc)));
}

export function metadata_key(hash: string): string {
  return `metadata/${hash.toLowerCase()}.json`;
}

/** True when the document hashes to the on-chain metadata_hash. */
export function verify_metadata(doc: unknown, onchain_hash: string): boolean {
  return metadata_hash(doc).toLowerCase() === onchain_hash.toLowerCase();
}
