/**
 * auth.routes.js
 * Real, working auth: register/login create or verify a hashed-password
 * user record (userStore.service.js) and issue a JWT carried in an httpOnly
 * cookie (auth.service.js). /me and /logout depend on that same cookie.
 */
import { Router } from "express";
import { z } from "zod";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { findUserByEmail, createUser, findUserById, updateUser, toPublicUser } from "../services/userStore.service.js";
import { hashPassword, verifyPassword, signSessionToken } from "../services/auth.service.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

const RegisterSchema = z.object({
  email:    z.string().trim().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  name:     z.string().trim().max(100).optional(),
});

const LoginSchema = z.object({
  email:    z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

const UpdateProfileSchema = z
  .object({
    name:            z.string().trim().max(100).nullable().optional(),
    email:           z.string().trim().email("Enter a valid email address.").optional(),
    currentPassword: z.string().optional(),
    newPassword:     z.string().min(8, "New password must be at least 8 characters.").optional(),
  })
  .refine((data) => data.name !== undefined || data.email !== undefined || data.newPassword !== undefined, {
    message: "Nothing to update.",
  });

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  // Cookies without `secure` still work over plain http://localhost in dev;
  // this MUST be true once the app is served over https in any real deployment.
  secure: config.nodeEnv === "production",
  maxAge: config.auth.tokenTtlSeconds * 1000,
};

function issueSession(res, user) {
  const token = signSessionToken(user);
  res.cookie(config.auth.cookieName, token, COOKIE_OPTIONS);
}

/** POST /api/auth/register */
router.post("/auth/register", async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." });
  }
  const { email, password, name } = parsed.data;

  try {
    if (findUserByEmail(email)) {
      return res.status(409).json({ success: false, error: "An account with this email already exists." });
    }
    const passwordHash = await hashPassword(password);
    const user = createUser({ email, name, passwordHash });
    issueSession(res, user);
    res.status(201).json({ success: true, data: toPublicUser(user) });
  } catch (err) {
    logger.error("[auth.routes] Registration failed", err);
    res.status(500).json({ success: false, error: "Could not create account." });
  }
});

/** POST /api/auth/login */
router.post("/auth/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." });
  }
  const { email, password } = parsed.data;

  try {
    const user = findUserByEmail(email);
    // Same generic message whether the email or the password was wrong —
    // never reveal which, so an attacker can't enumerate registered emails.
    const invalid = () => res.status(401).json({ success: false, error: "Invalid email or password." });
    if (!user) return invalid();

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return invalid();

    issueSession(res, user);
    res.json({ success: true, data: toPublicUser(user) });
  } catch (err) {
    logger.error("[auth.routes] Login failed", err);
    res.status(500).json({ success: false, error: "Login failed." });
  }
});

/** POST /api/auth/logout */
router.post("/auth/logout", (_req, res) => {
  res.clearCookie(config.auth.cookieName, { httpOnly: true, sameSite: "lax", secure: config.nodeEnv === "production" });
  res.json({ success: true });
});

/** GET /api/auth/me — the currently authenticated user, or 401. */
router.get("/auth/me", requireAuth, (req, res) => {
  const user = findUserById(req.user.id);
  if (!user) return res.status(401).json({ success: false, error: "Not authenticated." });
  res.json({ success: true, data: toPublicUser(user) });
});

/**
 * PATCH /api/auth/me — update the signed-in user's name, email, and/or
 * password. Changing email or password requires re-proving identity with
 * `currentPassword` (a live session cookie alone isn't enough for those —
 * matches the same reasoning a "change password" flow anywhere else uses:
 * an unattended, still-open session shouldn't be able to lock the real
 * owner out). Name-only edits don't require it.
 */
router.patch("/auth/me", requireAuth, async (req, res) => {
  const parsed = UpdateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." });
  }
  const { name, email, currentPassword, newPassword } = parsed.data;

  try {
    const user = findUserById(req.user.id);
    if (!user) return res.status(401).json({ success: false, error: "Not authenticated." });

    const changingSensitive = email !== undefined || newPassword !== undefined;
    if (changingSensitive) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, error: "Enter your current password to change your email or password." });
      }
      const ok = await verifyPassword(currentPassword, user.passwordHash);
      if (!ok) {
        return res.status(401).json({ success: false, error: "Current password is incorrect." });
      }
    }

    const patch = {};
    if (name !== undefined) patch.name = name;

    if (email !== undefined) {
      const normalized = email.trim().toLowerCase();
      if (normalized !== user.email) {
        const existing = findUserByEmail(normalized);
        if (existing && existing.id !== user.id) {
          return res.status(409).json({ success: false, error: "An account with this email already exists." });
        }
        patch.email = normalized;
      }
    }

    if (newPassword !== undefined) {
      patch.passwordHash = await hashPassword(newPassword);
    }

    const updated = updateUser(user.id, patch);
    // Re-issue the session since its payload embeds the email — keep them in sync.
    issueSession(res, updated);
    res.json({ success: true, data: toPublicUser(updated) });
  } catch (err) {
    logger.error("[auth.routes] Profile update failed", err);
    res.status(500).json({ success: false, error: "Could not update profile." });
  }
});

export default router;
