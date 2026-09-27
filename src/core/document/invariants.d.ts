/**
 * Project integrity checks.
 *
 * `parseProject` refuses a document that violates these, so a corrupted or
 * hand-edited file cannot enter the editor in a broken state. This is the
 * mechanical form of RULE 2 (reusable assets) and RULE 3 (Nia is not special).
 */
import type { Project } from '../types';
export interface ValidationIssue {
    path: string;
    message: string;
}
export declare function validateProject(project: Project): ValidationIssue[];
export declare function isProjectValid(project: Project): boolean;
