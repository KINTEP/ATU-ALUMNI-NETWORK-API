// src/routes/userRoutes.js
import express from "express";
import userController from "../controllers/userController.js";
import { verifyToken, isOwnerOrAdmin, optionalAuth } from "../middlewares/authMiddleware.js"; // ✅ added isOwnerOrAdmin


const router = express.Router();

// Public routes (no authentication required, but can be enhanced with optional auth)
router.get("/", optionalAuth, userController.getAllUsers);
router.get("/stats/overview", userController.getUserStats);
router.get("/:id", optionalAuth, userController.getUserById);

// Protected routes (authentication required - user can only update themselves)
router.put("/:id", verifyToken, isOwnerOrAdmin, userController.updateUser);
router.patch("/:id/password", verifyToken, isOwnerOrAdmin, userController.updatePassword);

// Admin only routes
//router.delete("/:id", verifyToken, isAdmin, userController.deleteUser);
//router.post("/:id/reactivate", verifyToken, isAdmin, userController.reactivateUser);

export default router;