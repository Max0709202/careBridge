import { z } from "zod";

/**
 * Input validation for authentication. Used by both the client forms (via the
 * RHF resolver) and the server actions, so a bypassed client check is still
 * caught on the server.
 */

export const signInSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  email: z.email("Enter a valid email address"),
  // GoTrue hashes with bcrypt, which ignores bytes past 72.
  password: z.string().min(8, "Use at least 8 characters").max(72, "Use 72 characters or fewer"),
  displayName: z.string().trim().min(1, "Enter your name").max(120).optional(),
  accountName: z.string().trim().min(1).max(160).optional(),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * Returned by the auth server actions when they do NOT redirect: either an
 * error to show, or a notice (e.g. "check your email" when confirmation is on).
 * On success the action redirects and nothing is returned.
 */
export interface AuthActionResult {
  error?: string;
  notice?: string;
}
