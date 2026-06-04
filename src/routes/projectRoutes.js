// src/routes/projectRoutes.js
import express from "express";
import projectController from "../controllers/projectController.js";
import { verifyToken, isAdmin, optionalAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

// ── IMPORTANT: Static routes MUST come before /:id ──
// In the original, GET /admin/all and GET /admin/donation-trends were placed
// AFTER GET /:id. Express would match /:id first (id='admin'), then try to
// match the second segment — causing 404s or wrong handler calls on those routes.

// ── Collection & static routes (no :id) ──
router.get("/", optionalAuth, projectController.getAllProjects);        // ✅ Restored
router.get("/stats", projectController.getProjectStats);
router.get("/top-donors", projectController.getTopDonors);
router.get("/recent-activity", projectController.getRecentActivity);

// ✅ FIX: Admin collection routes must be before /:id
router.get("/admin/all", verifyToken, isAdmin, projectController.adminGetAllProjects);
router.get("/admin/donation-trends", verifyToken, isAdmin, projectController.getDonationTrends);

// Admin creation (no :id)
router.post("/", verifyToken, isAdmin, projectController.createProject);

// ── Dynamic :id routes ──
router.get("/:id", optionalAuth, projectController.getProjectById);
router.get("/:id/donors", projectController.getProjectDonors);
router.get("/:id/volunteers", verifyToken, isAdmin, projectController.getProjectVolunteers);

// Authenticated user actions
router.post("/:id/donate", verifyToken, projectController.donate);
router.post("/:id/volunteer", verifyToken, projectController.volunteer);
router.delete("/:id/volunteer", verifyToken, projectController.withdrawVolunteer);
router.post("/:id/vote", verifyToken, projectController.vote);
router.delete("/:id/vote", verifyToken, projectController.retractVote);

// Admin :id actions
router.put("/:id", verifyToken, isAdmin, projectController.updateProject);
router.delete("/:id", verifyToken, isAdmin, projectController.deleteProject);
router.post("/:id/approve", verifyToken, isAdmin, projectController.approveProject);
router.post("/:id/reject", verifyToken, isAdmin, projectController.rejectProject);
router.post("/:id/complete", verifyToken, isAdmin, projectController.completeProject);
router.post("/:id/updates", verifyToken, isAdmin, projectController.addUpdate);
router.delete("/:id/updates/:updateId", verifyToken, isAdmin, projectController.deleteUpdate);

export default router;