/**
 * userStore.service.js
 * Local, file-backed user store (data/users.json) — no external database
 * in this project (matches the rule-profiles/*.json pattern of config
 * living on disk). Passwords are never stored here directly; callers pass
 * an already-hashed value (see auth.service.js).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config/env.js";

function ensureFile() {
  const file = config.auth.usersFile;
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, "[]\n", "utf-8");
  return file;
}

function readAll() {
  const file = ensureFile();
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // corrupted/unreadable — fail to empty rather than crash the server
  }
}

function writeAll(users) {
  const file = ensureFile();
  // Atomic write: write to a temp file then rename over the real one, so a
  // crash or concurrent read mid-write can never observe a truncated/corrupt
  // users.json — worst case the write simply hasn't landed yet.
  const tmpFile = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(users, null, 2) + "\n", "utf-8");
  fs.renameSync(tmpFile, file);
}

/** Total number of registered accounts — used for a startup sanity log (server.js). */
export function countUsers() {
  return readAll().length;
}

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

/** @returns {object|null} the user record (including passwordHash) or null */
export function findUserByEmail(email) {
  const target = normalizeEmail(email);
  return readAll().find((u) => u.email === target) ?? null;
}

/** @returns {object|null} the user record (including passwordHash) or null */
export function findUserById(id) {
  return readAll().find((u) => u.id === id) ?? null;
}

/**
 * Creates a new user. Caller is responsible for hashing the password and
 * checking for an existing account with the same email first.
 */
export function createUser({ email, name, passwordHash }) {
  const users = readAll();
  const user = {
    id: crypto.randomUUID(),
    email: normalizeEmail(email),
    name: name?.trim() || null,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeAll(users);
  return user;
}

/**
 * Applies a partial update to an existing user (profile edit / password
 * change — see PATCH /api/auth/me). `updatedAt` is stamped automatically.
 * @param {string} id
 * @param {{email?:string, name?:string|null, passwordHash?:string}} patch
 * @returns {object|null} the updated user record, or null if id doesn't exist
 */
export function updateUser(id, patch) {
  const users = readAll();
  const index = users.findIndex((u) => u.id === id);
  if (index === -1) return null;

  const next = { ...users[index] };
  if (patch.email !== undefined) next.email = normalizeEmail(patch.email);
  if (patch.name !== undefined) next.name = patch.name?.trim() || null;
  if (patch.passwordHash !== undefined) next.passwordHash = patch.passwordHash;
  next.updatedAt = new Date().toISOString();

  users[index] = next;
  writeAll(users);
  return next;
}

/** Strips the password hash before a user record leaves the service layer. */
export function toPublicUser(user) {
  if (!user) return null;
  const { id, email, name, createdAt, updatedAt } = user;
  return { id, email, name, createdAt, updatedAt: updatedAt ?? null };
}
