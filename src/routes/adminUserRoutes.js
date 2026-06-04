// src/routes/adminUserRoutes.js
import express from "express";
import adminUserController from "../controllers/adminUserController.js";
import { verifyToken, isAdmin } from "../middlewares/authMiddleware.js";

const router = express.Router();

// All routes require admin authentication
router.use(verifyToken, isAdmin);

// Bulk import alumni with auto-credentials
router.post("/import-alumni", adminUserController.bulkImportAlumni);

// Add single alumni
router.post("/add-alumni", adminUserController.addSingleAlumni);

// Resend credentials to specific user
router.post("/resend-credentials/:user_id", adminUserController.resendCredentials);

// ✅ FIX: Was pointing to deleteUser (hard delete) which no longer exists.
// Now points to deactivateUser (soft delete — sets is_active = false, preserves all data)
router.delete('/:id', adminUserController.deactivateUser);

// Permanent delete — requires { confirm: 'DELETE_PERMANENTLY' } in request body
// Use only for GDPR/data removal requests
router.delete('/:id/permanent', adminUserController.permanentDeleteUser);

// Reactivate a deactivated user
router.post('/:id/reactivate', adminUserController.reactivateUser);

export default router;