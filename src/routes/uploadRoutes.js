// src/routes/uploadRoutes.js
import express from "express";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from 'url';
import { verifyToken } from "../middlewares/authMiddleware.js";
import fs from 'fs';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure upload directories exist
const uploadDir = path.join(__dirname, '../../public/uploads/profiles');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueName = `profile-${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    cb(null, extname && mimetype ? true : new Error('Only image files allowed'));
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
});

/**
 * Upload profile picture
 * POST /api/upload/profile-picture
 */
router.post('/profile-picture', verifyToken, upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: "No file uploaded"
            });
        }

        // FIXED: Now returns correct path with /api
        const fileUrl = `/api/uploads/profiles/${req.file.filename}`;

        res.json({
            success: true,
            message: "Profile picture uploaded successfully",
            data: {
                url: fileUrl,                    // Now correct
                filename: req.file.filename,
                size: req.file.size,
                mimetype: req.file.mimetype
            }
        });

    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({
            success: false,
            error: error.message || "Failed to upload file"
        });
    }
});

/**
 * Upload cover photo
 * POST /api/upload/cover-photo
 */
router.post('/cover-photo', verifyToken, upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: "No file uploaded"
            });
        }

        // FIXED: Also correct path here
        const fileUrl = `/api/uploads/profiles/${req.file.filename}`;

        res.json({
            success: true,
            message: "Cover photo uploaded successfully",
            data: {
                url: fileUrl,
                filename: req.file.filename,
                size: req.file.size,
                mimetype: req.file.mimetype
            }
        });

    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({
            success: false,
            error: error.message || "Failed to upload file"
        });
    }
});

/**
 * Delete uploaded file
 * DELETE /api/upload/:filename
 */
router.delete('/:filename', verifyToken, (req, res) => {
    try {
        const { filename } = req.params;
        const filePath = path.join(uploadDir, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: "File not found"
            });
        }

        fs.unlinkSync(filePath);

        res.json({
            success: true,
            message: "File deleted successfully"
        });

    } catch (error) {
        console.error("Delete error:", error);
        res.status(500).json({
            success: false,
            error: "Failed to delete file"
        });
    }
});

/**
 * Multer error handling
 */
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File too large. Maximum size is 5MB'
            });
        }
    }
    if (error) {
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }
    next();
});

export default router;