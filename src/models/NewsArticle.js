// src/models/NewsArticle.js
import pool from "../config/db.js";

const NewsArticleModel = {
    // Create news_articles table
    createTable: async () => {
        const query = `
            -- Create news_articles table
            CREATE TABLE IF NOT EXISTS news_articles (
                id SERIAL PRIMARY KEY,
                
                -- Author (Admin)
                author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                
                -- Article Content
                title TEXT NOT NULL,
                slug TEXT UNIQUE NOT NULL,
                excerpt TEXT NOT NULL,
                content TEXT NOT NULL,
                featured_image TEXT,
                
                -- Classification
                category TEXT NOT NULL CHECK (category IN ('Academic', 'Career', 'Social', 'Alumni', 'University', 'General')),
                tags TEXT[],
                
                -- SEO
                meta_description TEXT,
                keywords TEXT,
                
                -- Status
                is_featured BOOLEAN DEFAULT FALSE,
                is_published BOOLEAN DEFAULT TRUE,
                published_at TIMESTAMP,
                
                -- Metrics
                views_count INTEGER DEFAULT 0,
                likes_count INTEGER DEFAULT 0,
                comments_count INTEGER DEFAULT 0,
                
                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                -- Constraints
                CHECK (char_length(title) >= 5),
                CHECK (char_length(excerpt) >= 20),
                CHECK (char_length(content) >= 50)
            );

            -- Create indexes
            CREATE INDEX IF NOT EXISTS idx_news_articles_author_id ON news_articles(author_id);
            CREATE INDEX IF NOT EXISTS idx_news_articles_slug ON news_articles(slug);
            CREATE INDEX IF NOT EXISTS idx_news_articles_category ON news_articles(category);
            CREATE INDEX IF NOT EXISTS idx_news_articles_is_featured ON news_articles(is_featured);
            CREATE INDEX IF NOT EXISTS idx_news_articles_is_published ON news_articles(is_published);
            CREATE INDEX IF NOT EXISTS idx_news_articles_published_at ON news_articles(published_at);
            CREATE INDEX IF NOT EXISTS idx_news_articles_created_at ON news_articles(created_at);
            CREATE INDEX IF NOT EXISTS idx_news_articles_tags ON news_articles USING GIN(tags);

            -- Create trigger to auto-update updated_at
            DROP TRIGGER IF EXISTS update_news_articles_updated_at ON news_articles;
            CREATE TRIGGER update_news_articles_updated_at
                BEFORE UPDATE ON news_articles
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();

            -- Create trigger to set published_at when is_published changes to true
            CREATE OR REPLACE FUNCTION set_published_at()
            RETURNS TRIGGER AS \$\$
            BEGIN
                IF NEW.is_published = TRUE AND (OLD.is_published = FALSE OR OLD.published_at IS NULL) THEN
                    NEW.published_at = CURRENT_TIMESTAMP;
                END IF;
                RETURN NEW;
            END;
            \$\$ LANGUAGE plpgsql;

            DROP TRIGGER IF EXISTS trigger_set_published_at ON news_articles;
            CREATE TRIGGER trigger_set_published_at
                BEFORE INSERT OR UPDATE ON news_articles
                FOR EACH ROW
                EXECUTE FUNCTION set_published_at();
        `;

        try {
            await pool.query(query);
            console.log("✅ News Articles table created successfully with all indexes and triggers!");
            return true;
        } catch (error) {
            console.error("❌ Error creating news_articles table:", error);
            throw error;
        }
    },

    // Drop table
    dropTable: async () => {
        try {
            await pool.query("DROP TABLE IF EXISTS news_articles CASCADE;");
            console.log("✅ News Articles table dropped successfully!");
            return true;
        } catch (error) {
            console.error("❌ Error dropping news_articles table:", error);
            throw error;
        }
    }
};

export default NewsArticleModel;