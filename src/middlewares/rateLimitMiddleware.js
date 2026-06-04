// src/middlewares/rateLimitMiddleware.js
import rateLimit from "express-rate-limit";

// ⚠️  DEVELOPMENT / TESTING MODE — limits raised
// TODO: Tighten before go-live:
//   registrationLimiter: max 3
//   authLimiter:         max 5
//   passwordResetLimiter: max 3
//   messageLimiter:      max 10
//   apiLimiter:          max 500

// General API rate limiter
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10000,
    message: { success: false, error: "Too many requests from this IP, please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});

// Auth rate limiter (login, token refresh)
export const authLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 100,
    message: { success: false, error: "Too many login attempts, please try again after 1 minute." },
    skipSuccessfulRequests: true,
});

// Registration rate limiter
export const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 100,
    message: { success: false, error: "Too many accounts created from this IP, please try again after an hour." },
});

// Password reset rate limiter
export const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 100,
    message: { success: false, error: "Too many password reset attempts, please try again after an hour." },
});

// Message sending rate limiter
export const messageLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1000,
    message: { success: false, error: "Too many messages sent, please slow down." },
});