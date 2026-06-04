// src/routes/notificationRoutes.js
import express from 'express';
import { verifyToken } from '../middlewares/authMiddleware.js';
import * as notificationController from '../controllers/notificationController.js';

const router = express.Router();

// All routes require authentication
router.use(verifyToken);

// ── IMPORTANT: Static routes MUST come before /:id ──
// PUT /read-all and DELETE /read were placed after PUT /:id/read and DELETE /:id
// in the original. Express would match /:id first treating 'read-all' and 'read'
// as the :id parameter, so those endpoints would silently never work.

// ── Collection routes (no :id) ──
router.get('/', notificationController.getNotifications);
router.get('/unread', notificationController.getUnreadNotifications);
router.get('/stats', notificationController.getNotificationStats);

// ✅ FIX: These must be BEFORE /:id/read and DELETE /:id
// Otherwise Express matches /:id where id='read-all' or id='read'
router.put('/read-all', notificationController.markAllAsRead);
router.delete('/read', notificationController.deleteAllRead);

// ── Dynamic :id routes ──
router.put('/:id/read', notificationController.markNotificationAsRead);
router.delete('/:id', notificationController.deleteNotification);

export default router;