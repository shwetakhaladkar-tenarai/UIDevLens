/**
 * auth.service.js
 * Password hashing (bcrypt) and session token issuance/verification (JWT,
 * carried in an httpOnly cookie — see auth.middleware.js and auth.routes.js).
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config/env.js";

const SALT_ROUNDS = 10;

export function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

/** Signs a session token for a user. Payload is intentionally minimal (id + email). */
export function signSessionToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.auth.jwtSecret, {
    expiresIn: config.auth.tokenTtlSeconds,
  });
}

/** @returns {{sub:string, email:string}} @throws if the token is missing/expired/invalid */
export function verifySessionToken(token) {
  return jwt.verify(token, config.auth.jwtSecret);
}
