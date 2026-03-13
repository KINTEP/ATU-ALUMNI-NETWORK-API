// src/routes/projectRoutes.js
import express from "express";
import projectController from "../controllers/projectController.js";
import { verifyToken, isAdmin, optionalAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

// ── Public / Alumni routes ──
router.get("/", optionalAuth, projectController.getAllProjects);
router.get("/stats", projectController.getProjectStats);
router.get("/top-donors", projectController.getTopDonors);
router.get("/recent-activity", projectController.getRecentActivity);
router.get("/:id", optionalAuth, projectController.getProjectById);
router.get("/:id/donors", projectController.getProjectDonors);

// ── Authenticated user actions ──
router.post("/:id/donate", verifyToken, projectController.donate);
router.post("/:id/volunteer", verifyToken, projectController.volunteer);
router.delete("/:id/volunteer", verifyToken, projectController.withdrawVolunteer);
router.post("/:id/vote", verifyToken, projectController.vote);
router.delete("/:id/vote", verifyToken, projectController.retractVote);

// ── Admin only routes ──
router.get("/admin/all", verifyToken, isAdmin, projectController.adminGetAllProjects);
router.get("/admin/donation-trends", verifyToken, isAdmin, projectController.getDonationTrends);
router.post("/", verifyToken, isAdmin, projectController.createProject);
router.put("/:id", verifyToken, isAdmin, projectController.updateProject);
router.delete("/:id", verifyToken, isAdmin, projectController.deleteProject);
router.post("/:id/approve", verifyToken, isAdmin, projectController.approveProject);
router.post("/:id/reject", verifyToken, isAdmin, projectController.rejectProject);
router.post("/:id/complete", verifyToken, isAdmin, projectController.completeProject);
router.post("/:id/updates", verifyToken, isAdmin, projectController.addUpdate);
router.delete("/:id/updates/:updateId", verifyToken, isAdmin, projectController.deleteUpdate);
router.get("/:id/volunteers", verifyToken, isAdmin, projectController.getProjectVolunteers);

export default router;