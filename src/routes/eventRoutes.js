// src/routes/eventRoutes.js
import express from "express";
import eventController from "../controllers/eventController.js";
import { verifyToken, isAdmin, optionalAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

// ─── Static routes MUST come before /:id ─────────────────────────────────────
// Express matches routes top-to-bottom. Any route with a fixed path segment
// (stats, upcoming, past, my-events) must be registered before /:id or Express
// will treat the segment as the :id parameter.

router.get("/stats",     eventController.getEventStats);
router.get("/upcoming",  optionalAuth, eventController.getUpcomingEvents);
router.get("/past",      optionalAuth, eventController.getPastEvents);
router.get("/my-events", verifyToken,  eventController.getMyEvents);

// ─── Dynamic :id routes ───────────────────────────────────────────────────────
router.get("/:id",                      optionalAuth, eventController.getEventById);
router.get("/:id/comments",             optionalAuth, eventController.getEventComments);
router.get("/:id/comments/:commentId/replies", optionalAuth, eventController.getCommentReplies);
router.get("/:id/attendees",            verifyToken, isAdmin, eventController.getEventAttendees);

router.post("/:id/view",                optionalAuth, eventController.incrementViewCount);
router.post("/:id/rsvp",               verifyToken,  eventController.rsvpToEvent);
router.post("/:id/comments",           verifyToken,  eventController.addComment);
router.post("/:id/comments/:commentId/reply", verifyToken, eventController.replyToComment);
router.post("/:id/comments/:commentId/like",  verifyToken, eventController.likeComment);
router.post("/:id/publish",            verifyToken,  isAdmin, eventController.publishEvent);

router.put("/:id",                     verifyToken,  isAdmin, eventController.updateEvent);
router.put("/:id/rsvp",               verifyToken,  eventController.updateRsvp);
router.put("/:id/comments/:commentId", verifyToken,  eventController.updateComment);
router.put("/:id/attendees/:userId",   verifyToken,  isAdmin, eventController.checkInAttendee);

router.delete("/:id",                          verifyToken, isAdmin, eventController.deleteEvent);
router.delete("/:id/rsvp",                    verifyToken, eventController.cancelRsvp);
router.delete("/:id/comments/:commentId",     verifyToken, eventController.deleteComment);
router.delete("/:id/comments/:commentId/unlike", verifyToken, eventController.unlikeComment);

// ─── Collection routes (no :id) ───────────────────────────────────────────────
router.get("/",  optionalAuth, eventController.getAllEvents);
router.post("/", verifyToken,  isAdmin, eventController.createEvent);

export default router;