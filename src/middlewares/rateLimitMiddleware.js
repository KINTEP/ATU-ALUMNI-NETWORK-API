// src/middlewares/rateLimitMiddleware.js
import rateLimit from "express-rate-limit";

// General API rate limiter
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10000, // Limit each IP to 100 requests per windowMs
    message: {
        success: false,
        error: "Too many requests from this IP, please try again later."
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Strict rate limiter for auth endpoints
export const authLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 login attempts per windowMs
    message: {
        success: false,
        error: "Too many login attempts, please try again after 15 minutes."
    },
    skipSuccessfulRequests: true, // Don't count successful logins
});

// Registration rate limiter
export const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // Limit each IP to 3 registrations per hour
    message: {
        success: false,
        error: "Too many accounts created from this IP, please try again after an hour."
    },
});

// Password reset rate limiter
export const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // Limit each IP to 3 password reset requests per hour
    message: {
        success: false,
        error: "Too many password reset attempts, please try again after an hour."
    },
});

// Message sending rate limiter
export const messageLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Limit to 10 messages per minute
    message: {
        success: false,
        error: "Too many messages sent, please slow down."
    },
});