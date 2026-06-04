// src/models/Project.js
import pool from "../config/db.js";

const ProjectModel = {

    // ==================== CREATE ALL PROJECT TABLES ====================
    createTables: async () => {
        const query = `

            -- ==================== PROJECTS ====================
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,

                -- Basic Info
                title VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                long_description TEXT,
                category VARCHAR(100) NOT NULL,

                -- Status
                status VARCHAR(50) NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed', 'voting', 'approved', 'in_progress', 'completed', 'cancelled')),

                -- Location
                location VARCHAR(255) NOT NULL,
                cover_image VARCHAR(500),

                -- Timeline
                start_date DATE NOT NULL,
                target_date DATE,

                -- Funding
                funding_goal NUMERIC(12,2) NOT NULL DEFAULT 0,
                current_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                accept_donations BOOLEAN DEFAULT TRUE,

                -- Volunteers
                accept_volunteers BOOLEAN DEFAULT TRUE,
                max_volunteers INTEGER,

                -- Display
                is_featured BOOLEAN DEFAULT FALSE,

                -- Voting (community approval before project starts)
                votes_required INTEGER DEFAULT 100,

                -- Creator
                created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
            CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
            CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category);
            CREATE INDEX IF NOT EXISTS idx_projects_is_featured ON projects(is_featured);
            CREATE INDEX IF NOT EXISTS idx_projects_start_date ON projects(start_date);
            CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);

            -- Auto-update updated_at
            DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
            CREATE TRIGGER update_projects_updated_at
                BEFORE UPDATE ON projects
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();


            -- ==================== PROJECT UPDATES ====================
            CREATE TABLE IF NOT EXISTS project_updates (
                id SERIAL PRIMARY KEY,

                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                posted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                type VARCHAR(50) DEFAULT 'update'
                    CHECK (type IN ('update', 'milestone', 'announcement', 'completion')),
                image VARCHAR(500),

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_project_updates_project_id ON project_updates(project_id);
            CREATE INDEX IF NOT EXISTS idx_project_updates_posted_by ON project_updates(posted_by);
            CREATE INDEX IF NOT EXISTS idx_project_updates_created_at ON project_updates(created_at);
            CREATE INDEX IF NOT EXISTS idx_project_updates_type ON project_updates(type);


            -- ==================== PROJECT DONATIONS ====================
            CREATE TABLE IF NOT EXISTS project_donations (
                id SERIAL PRIMARY KEY,

                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

                amount NUMERIC(12,2) NOT NULL,
                reference VARCHAR(255),           -- Payment gateway reference (Paystack)
                payment_method VARCHAR(50) DEFAULT 'paystack'
                    CHECK (payment_method IN ('paystack', 'momo', 'bank_transfer', 'cash', 'other')),
                status VARCHAR(50) DEFAULT 'completed'
                    CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
                anonymous BOOLEAN DEFAULT FALSE,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_project_donations_project_id ON project_donations(project_id);
            CREATE INDEX IF NOT EXISTS idx_project_donations_user_id ON project_donations(user_id);
            CREATE INDEX IF NOT EXISTS idx_project_donations_status ON project_donations(status);
            CREATE INDEX IF NOT EXISTS idx_project_donations_created_at ON project_donations(created_at);
            CREATE INDEX IF NOT EXISTS idx_project_donations_reference ON project_donations(reference);

            -- Auto-update projects.current_amount when a completed donation is inserted
            CREATE OR REPLACE FUNCTION increment_project_amount()
            RETURNS TRIGGER AS $$
            BEGIN
                IF NEW.status = 'completed' THEN
                    UPDATE projects
                    SET current_amount = current_amount + NEW.amount
                    WHERE id = NEW.project_id;
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;

            DROP TRIGGER IF EXISTS trigger_increment_project_amount ON project_donations;
            CREATE TRIGGER trigger_increment_project_amount
                AFTER INSERT ON project_donations
                FOR EACH ROW
                EXECUTE FUNCTION increment_project_amount();

            -- Reverse amount if a donation is refunded
            CREATE OR REPLACE FUNCTION handle_donation_status_change()
            RETURNS TRIGGER AS $$
            BEGIN
                -- Was completed, now refunded → subtract
                IF OLD.status = 'completed' AND NEW.status = 'refunded' THEN
                    UPDATE projects
                    SET current_amount = current_amount - OLD.amount
                    WHERE id = OLD.project_id;
                -- Was pending, now completed → add
                ELSIF OLD.status = 'pending' AND NEW.status = 'completed' THEN
                    UPDATE projects
                    SET current_amount = current_amount + NEW.amount
                    WHERE id = NEW.project_id;
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;

            DROP TRIGGER IF EXISTS trigger_handle_donation_status_change ON project_donations;
            CREATE TRIGGER trigger_handle_donation_status_change
                AFTER UPDATE ON project_donations
                FOR EACH ROW
                EXECUTE FUNCTION handle_donation_status_change();


            -- ==================== PROJECT VOLUNTEERS ====================
            CREATE TABLE IF NOT EXISTS project_volunteers (
                id SERIAL PRIMARY KEY,

                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                -- One volunteer slot per user per project
                UNIQUE(project_id, user_id)
            );

            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_project_volunteers_project_id ON project_volunteers(project_id);
            CREATE INDEX IF NOT EXISTS idx_project_volunteers_user_id ON project_volunteers(user_id);
            CREATE INDEX IF NOT EXISTS idx_project_volunteers_joined_at ON project_volunteers(joined_at);


            -- ==================== PROJECT VOTES ====================
            CREATE TABLE IF NOT EXISTS project_votes (
                id SERIAL PRIMARY KEY,

                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

                voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                -- One vote per user per project
                UNIQUE(project_id, user_id)
            );

            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_project_votes_project_id ON project_votes(project_id);
            CREATE INDEX IF NOT EXISTS idx_project_votes_user_id ON project_votes(user_id);
            CREATE INDEX IF NOT EXISTS idx_project_votes_voted_at ON project_votes(voted_at);

            -- Auto-approve project when votes_required threshold is reached
            CREATE OR REPLACE FUNCTION check_project_votes()
            RETURNS TRIGGER AS $$
            DECLARE
                vote_count INTEGER;
                required INTEGER;
                current_status VARCHAR;
            BEGIN
                SELECT COUNT(*), p.votes_required, p.status
                INTO vote_count, required, current_status
                FROM project_votes pv
                JOIN projects p ON p.id = pv.project_id
                WHERE pv.project_id = NEW.project_id
                GROUP BY p.votes_required, p.status;

                -- Only move from 'voting' → 'approved' automatically
                IF current_status = 'voting' AND vote_count >= required THEN
                    UPDATE projects
                    SET status = 'approved'
                    WHERE id = NEW.project_id;
                END IF;

                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;

            DROP TRIGGER IF EXISTS trigger_check_project_votes ON project_votes;
            CREATE TRIGGER trigger_check_project_votes
                AFTER INSERT ON project_votes
                FOR EACH ROW
                EXECUTE FUNCTION check_project_votes();
        `;

        try {
            await pool.query(query);
            console.log("✅ All project tables created successfully with indexes, triggers, and constraints!");
            return true;
        } catch (error) {
            console.error("❌ Error creating project tables:", error);
            throw error;
        }
    },


    // ==================== DROP ALL PROJECT TABLES ====================
    dropTables: async () => {
        try {
            await pool.query("DROP FUNCTION IF EXISTS check_project_votes() CASCADE;");
            await pool.query("DROP FUNCTION IF EXISTS handle_donation_status_change() CASCADE;");
            await pool.query("DROP FUNCTION IF EXISTS increment_project_amount() CASCADE;");
            await pool.query("DROP TABLE IF EXISTS project_votes CASCADE;");
            await pool.query("DROP TABLE IF EXISTS project_volunteers CASCADE;");
            await pool.query("DROP TABLE IF EXISTS project_donations CASCADE;");
            await pool.query("DROP TABLE IF EXISTS project_updates CASCADE;");
            await pool.query("DROP TABLE IF EXISTS projects CASCADE;");
            console.log("✅ All project tables dropped successfully!");
            return true;
        } catch (error) {
            console.error("❌ Error dropping project tables:", error);
            throw error;
        }
    },


    // ==================== HELPER QUERIES ====================

    // Get full project summary (used in routes)
    getProjectSummary: async (projectId) => {
        try {
            const result = await pool.query(`
                SELECT 
                    p.*,
                    u.first_name || ' ' || u.last_name AS created_by_name,
                    u.profile_picture AS created_by_picture,
                    (SELECT COUNT(*) FROM project_votes WHERE project_id = p.id) AS votes_count,
                    (SELECT COUNT(*) FROM project_volunteers WHERE project_id = p.id) AS volunteers_count,
                    (SELECT COUNT(*) FROM project_donations WHERE project_id = p.id AND status = 'completed') AS donors_count
                FROM projects p
                JOIN users u ON p.created_by = u.id
                WHERE p.id = $1
            `, [projectId]);
            return result.rows[0] || null;
        } catch (error) {
            console.error("Error fetching project summary:", error);
            throw error;
        }
    },

    // Check if user has voted on a project
    hasVoted: async (projectId, userId) => {
        try {
            const result = await pool.query(
                "SELECT id FROM project_votes WHERE project_id = $1 AND user_id = $2",
                [projectId, userId]
            );
            return result.rows.length > 0;
        } catch (error) {
            console.error("Error checking vote:", error);
            throw error;
        }
    },

    // Check if user is a volunteer on a project
    isVolunteer: async (projectId, userId) => {
        try {
            const result = await pool.query(
                "SELECT id FROM project_volunteers WHERE project_id = $1 AND user_id = $2",
                [projectId, userId]
            );
            return result.rows.length > 0;
        } catch (error) {
            console.error("Error checking volunteer status:", error);
            throw error;
        }
    }
};

export default ProjectModel;