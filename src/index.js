// src/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import pool from "./config/db.js";
import path from "path";
import { fileURLToPath } from 'url';
import fs from 'fs';

// Import routes
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import jobRoutes from "./routes/jobRoutes.js";
import eventRoutes from "./routes/eventRoutes.js";
import forumRoutes from "./routes/forumRoutes.js";
import newsRoutes from "./routes/newsRoutes.js";
import tracerStudyRoutes from "./routes/tracerStudyRoutes.js";
import academicRoutes from "./routes/academicRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import connectionRoutes from "./routes/connectionRoutes.js";
import adminUserRoutes from "./routes/adminUserRoutes.js";
import notificationRoutes from './routes/notificationRoutes.js';
import uploadRoutes from "./routes/uploadRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";

// Import middlewares
import { apiLimiter } from "./middlewares/rateLimitMiddleware.js";
import { notFound, errorHandler } from "./middlewares/errorMiddleware.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================== MIDDLEWARE CONFIGURATION ==================

app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
    origin: [
        'https://atu-alumni-network.web.app',
        'https://atu-alumni-network.firebaseapp.com',
        'http://localhost:4200',
        'http://localhost:3000',
        'http://localhost:5173'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ================== SERVE UPLOADED IMAGES FIRST (MUST BE BEFORE RATE LIMITER!) ==================
const uploadsPath = path.join(__dirname, '../public/uploads');
console.log('Serving static files from:', uploadsPath);

app.use('/api/uploads', express.static(uploadsPath, {
    setHeaders: (res, filePath) => {
        if (filePath.match(/\.(jpg|jpeg)$/i)) res.setHeader('Content-Type', 'image/jpeg');
        if (filePath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
        if (filePath.endsWith('.gif')) res.setHeader('Content-Type', 'image/gif');
        if (filePath.endsWith('.webp')) res.setHeader('Content-Type', 'image/webp');
    }
}));

// ================== RATE LIMITER — NOW SKIPS /api/uploads ==================
app.use('/api/', apiLimiter);

// ================== ROUTES ==================

app.get("/", async (req, res) => {
    try {
        const result = await pool.query("SELECT current_database(), NOW() as server_time");
        res.json({
            success: true,
            message: "ATU Alumni Network API",
            version: "1.0.0",
            database: result.rows[0].current_database,
            server_time: result.rows[0].server_time,
            endpoints: {
                auth: "/api/auth",
                users: "/api/users",
                jobs: "/api/jobs",
                events: "/api/events",
                forums: "/api/forums",
                news: "/api/news",
                projects: "/api/projects",
                tracerStudy: "/api/tracer-study",
                academic: "/api/academic",
                messages: "/api/messages",
                notifications: "/api/notifications",
                connections: "/api/connections",
                upload: "/api/upload",
                uploads: "/api/uploads"
            }
        });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({
            success: false,
            error: "Database connection failed"
        });
    }
});

app.get("/api/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({
            success: true,
            status: "healthy",
            database: "connected",
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            success: false,
            status: "unhealthy",
            database: "disconnected",
            error: error.message
        });
    }
});

app.get("/api/test/images", (req, res) => {
    try {
        const profilesDir = path.join(__dirname, '../public/uploads/profiles');
        
        if (!fs.existsSync(profilesDir)) {
            return res.status(404).json({
                success: false,
                error: "Upload directory not found",
                path: profilesDir
            });
        }
        
        const files = fs.readdirSync(profilesDir);
        
        res.json({
            success: true,
            directory: profilesDir,
            count: files.length,
            files: files,
            urls: files.map(f => `${req.protocol}://${req.get('host')}/api/uploads/profiles/${f}`)
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ================== API ROUTES ==================
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/forums", forumRoutes);
app.use("/api/news", newsRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/tracer-study", tracerStudyRoutes);
app.use("/api/academic", academicRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/connections", connectionRoutes);
app.use("/api/admin/users", adminUserRoutes);
app.use('/api/notifications', notificationRoutes);
app.use("/api/upload", uploadRoutes);

// ================== ERROR HANDLERS ==================
app.use(notFound);
app.use(errorHandler);

// ================== START SERVER ==================
app.listen(port, () => {
    console.log(`
╔════════════════════════════════════════╗
║  ATU Alumni Network API                ║
║                                        ║
║  Server: http://localhost:${port}       ║
║  Status: Running                       ║
║  Environment: ${process.env.NODE_ENV || 'development'}              ║
╚════════════════════════════════════════╝

  Static Files:    /api/uploads
  Health Check:    /api/health
  Test Images:     /api/test/images
    `);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Promise Rejection:', err);
});