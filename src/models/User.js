// src/models/User.js
import pool from "../config/db.js";

const UserModel = {
    // Create users table
    createTable: async () => {
        const query = `
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                
                -- Authentication
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'alumni' CHECK (role IN ('alumni', 'admin')),
                
                -- Personal Information
                first_name VARCHAR(100) NOT NULL,
                last_name VARCHAR(100) NOT NULL,
                other_name VARCHAR(100),
                phone_number VARCHAR(20),
                date_of_birth DATE,
                gender VARCHAR(20) CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
                
                -- Academic Information
                student_id VARCHAR(50),
                graduation_year INTEGER,
                program_of_study VARCHAR(100),
                major VARCHAR(100),
                faculty VARCHAR(100),
                department VARCHAR(100),
                
                -- Professional Information
                current_company VARCHAR(255),
                job_title VARCHAR(255),
                industry VARCHAR(100),
                years_of_experience INTEGER,
                
                -- Location
                current_city VARCHAR(100),
                current_country VARCHAR(100),
                hometown VARCHAR(100),
                
                -- Profile Details
                bio TEXT,
                profile_picture VARCHAR(500),
                cover_photo VARCHAR(500),
                
                -- Social Links
                linkedin_url VARCHAR(500),
                twitter_url VARCHAR(500),
                facebook_url VARCHAR(500),
                website_url VARCHAR(500),
                
                -- Skills & Interests
                skills TEXT[],
                interests TEXT[],
                
                -- Account Status
                is_verified BOOLEAN DEFAULT FALSE,
                is_active BOOLEAN DEFAULT TRUE,
                email_verified BOOLEAN DEFAULT FALSE,
                last_login TIMESTAMP,
                
                -- Privacy Settings
                profile_visibility VARCHAR(20) DEFAULT 'public' CHECK (profile_visibility IN ('public', 'alumni_only', 'private')),
                show_email BOOLEAN DEFAULT FALSE,
                show_phone BOOLEAN DEFAULT FALSE,
                
                -- ✅ Bulk import: FALSE = pre-created by admin, TRUE = alumni has set their own password
                is_claimed BOOLEAN DEFAULT FALSE,
                
                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Create indexes for better query performance
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
            CREATE INDEX IF NOT EXISTS idx_users_graduation_year ON users(graduation_year);
            CREATE INDEX IF NOT EXISTS idx_users_major ON users(major);
            CREATE INDEX IF NOT EXISTS idx_users_program ON users(program_of_study);
            CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
            CREATE INDEX IF NOT EXISTS idx_users_is_claimed ON users(is_claimed);
            CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

            -- Create function to auto-update updated_at timestamp
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS \$\$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            \$\$ language 'plpgsql';

            -- Create trigger to auto-update updated_at
            DROP TRIGGER IF EXISTS update_users_updated_at ON users;
            CREATE TRIGGER update_users_updated_at
                BEFORE UPDATE ON users
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();
        `;

        try {
            await pool.query(query);
            console.log("✅ Users table created successfully with all indexes and triggers!");
            return true;
        } catch (error) {
            console.error("❌ Error creating users table:", error);
            throw error;
        }
    },

    // Drop table (for development/testing only)
    dropTable: async () => {
        try {
            await pool.query("DROP TABLE IF EXISTS users CASCADE;");
            console.log("✅ Users table dropped successfully!");
            return true;
        } catch (error) {
            console.error("❌ Error dropping users table:", error);
            throw error;
        }
    }
};

export default UserModel;