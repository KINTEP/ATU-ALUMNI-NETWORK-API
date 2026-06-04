// src/models/Notification.js
import pool from "../config/db.js";

const NotificationModel = {
    // Create notifications table
    createTables: async () => {
        const query = `
            -- ==================== NOTIFICATIONS TABLE ====================
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                type VARCHAR(50) NOT NULL,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                link VARCHAR(500),
                is_read BOOLEAN DEFAULT FALSE,
                read_at TIMESTAMP,
                metadata JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- ==================== INDEXES ====================
            CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
            CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
            CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
            CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);

            -- ==================== TRIGGERS ====================

            CREATE OR REPLACE FUNCTION update_notifications_updated_at()
            RETURNS TRIGGER AS \$\$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            \$\$ LANGUAGE plpgsql;

            DROP TRIGGER IF EXISTS update_notifications_updated_at ON notifications;
            CREATE TRIGGER update_notifications_updated_at
                BEFORE UPDATE ON notifications
                FOR EACH ROW
                EXECUTE FUNCTION update_notifications_updated_at();

            -- ==================== VIEWS ====================

            CREATE OR REPLACE VIEW v_notification_stats AS
            SELECT 
                user_id,
                COUNT(*) as total_notifications,
                COUNT(*) FILTER (WHERE is_read = FALSE) as unread_count,
                COUNT(*) FILTER (WHERE type = 'connection_request') as connection_requests,
                COUNT(*) FILTER (WHERE type = 'connection_accepted') as connection_accepted,
                COUNT(*) FILTER (WHERE type = 'event_rsvp') as event_rsvps,
                COUNT(*) FILTER (WHERE type = 'event_reminder') as event_reminders,
                COUNT(*) FILTER (WHERE type = 'job_application') as job_applications,
                COUNT(*) FILTER (WHERE type = 'message') as messages,
                COUNT(*) FILTER (WHERE type = 'forum_reply') as forum_replies,
                COUNT(*) FILTER (WHERE type = 'system') as system_notifications,
                MAX(created_at) as last_notification_at
            FROM notifications
            GROUP BY user_id;

            CREATE OR REPLACE VIEW v_recent_unread_notifications AS
            SELECT 
                n.id,
                n.user_id,
                n.type,
                n.title,
                n.message,
                n.link,
                n.metadata,
                n.created_at,
                u.first_name,
                u.last_name,
                u.email
            FROM notifications n
            JOIN users u ON n.user_id = u.id
            WHERE n.is_read = FALSE
            AND n.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
            ORDER BY n.created_at DESC;

            CREATE OR REPLACE VIEW v_notification_activity AS
            SELECT 
                DATE(created_at) as notification_date,
                type,
                COUNT(*) as count,
                COUNT(*) FILTER (WHERE is_read = TRUE) as read_count,
                COUNT(*) FILTER (WHERE is_read = FALSE) as unread_count
            FROM notifications
            WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
            GROUP BY DATE(created_at), type
            ORDER BY notification_date DESC, count DESC;

            -- ==================== COMMENTS ====================
            COMMENT ON TABLE notifications IS 'Stores all in-app notifications for users';
            COMMENT ON COLUMN notifications.type IS 'Type: connection_request, connection_accepted, event_rsvp, event_reminder, job_application, message, forum_reply, system';
            COMMENT ON COLUMN notifications.read_at IS 'Timestamp when notification was marked as read';
            COMMENT ON COLUMN notifications.metadata IS 'Additional data stored as JSON (e.g., sender_id, event_id, job_id)';
            COMMENT ON COLUMN notifications.link IS 'Internal app link to navigate when notification is clicked';
        `;

        try {
            await pool.query(query);
            console.log("✅ Notifications table created successfully with all indexes, triggers, and views!");
            return true;
        } catch (error) {
            console.error("❌ Error creating notifications table:", error);
            throw error;
        }
    },

    // Drop notifications table
    dropTables: async () => {
        try {
            await pool.query("DROP VIEW IF EXISTS v_notification_activity CASCADE;");
            await pool.query("DROP VIEW IF EXISTS v_recent_unread_notifications CASCADE;");
            await pool.query("DROP VIEW IF EXISTS v_notification_stats CASCADE;");
            await pool.query("DROP TRIGGER IF EXISTS update_notifications_updated_at ON notifications;");
            await pool.query("DROP FUNCTION IF EXISTS update_notifications_updated_at() CASCADE;");
            await pool.query("DROP TABLE IF EXISTS notifications CASCADE;");
            console.log("✅ Notifications table dropped successfully!");
            return true;
        } catch (error) {
            console.error("❌ Error dropping notifications table:", error);
            throw error;
        }
    },

    // Get notification stats for a user
    getStats: async (userId) => {
        try {
            const result = await pool.query(
                "SELECT * FROM v_notification_stats WHERE user_id = $1",
                [userId]
            );
            return result.rows[0] || null;
        } catch (error) {
            console.error("Error getting notification stats:", error);
            throw error;
        }
    },

    // Get recent unread notifications for a user
    getRecentUnread: async (userId, limit = 10) => {
        try {
            const result = await pool.query(
                `SELECT * FROM v_recent_unread_notifications 
                 WHERE user_id = $1 
                 ORDER BY created_at DESC 
                 LIMIT $2`,
                [userId, limit]
            );
            return result.rows;
        } catch (error) {
            console.error("Error getting recent unread notifications:", error);
            throw error;
        }
    }
};

export default NotificationModel;