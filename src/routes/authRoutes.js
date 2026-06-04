// src/routes/authRoutes.js
import express from "express";
import authController from "../controllers/authController.js";
import { verifyToken } from "../middlewares/authMiddleware.js";
import { 
    validateRegistration, 
    validateLogin 
} from "../middlewares/validationMiddleware.js";
import { 
    authLimiter, 
    registrationLimiter, 
    passwordResetLimiter 
} from "../middlewares/rateLimitMiddleware.js";

const router = express.Router();

// Public routes
router.post("/register", registrationLimiter, validateRegistration, authController.register);
router.post("/login", authLimiter, validateLogin, authController.login);
router.post("/request-password-reset", passwordResetLimiter, authController.requestPasswordReset);
router.post("/reset-password", authController.resetPassword);
router.post("/verify-email", authController.verifyEmail);

// Protected routes (require authentication)
router.get("/me", verifyToken, authController.getMe);
router.post("/change-password", verifyToken, authController.changePassword);
router.post("/logout", verifyToken, authController.logout);

// Add these two lines with the public routes
router.post("/verify-alumni", authLimiter, authController.verifyAlumni);
router.post("/self-register", registrationLimiter, authController.selfRegister);

export default router;