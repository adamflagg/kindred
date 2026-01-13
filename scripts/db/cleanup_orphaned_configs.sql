-- Config Cleanup SQL - Remove Orphaned Config Keys
-- Date: 2025-12-28 (Updated)
-- Purpose: Remove orphaned config keys from database
-- Run with: sqlite3 pocketbase/pb_data/data.db < scripts/cleanup_orphaned_configs.sql

-- ============================================
-- REMOVE: priority.* (old 10-level system, never read by any code)
-- ============================================
DELETE FROM config WHERE category = 'priority';

-- ============================================
-- REMOVE: ai.priority_defaults* (wrong path structure - code looks for 'priority' not 'priority_defaults')
-- ============================================
DELETE FROM config WHERE category = 'ai' AND subcategory LIKE 'priority_defaults%';

-- ============================================
-- REMOVE: Friend group configs (never implemented - lock groups are separate)
-- ============================================
DELETE FROM config WHERE subcategory = 'friend_group';

-- ============================================
-- REMOVE: spread.* (dormmate spreading never implemented)
-- ============================================
DELETE FROM config WHERE category = 'spread';

-- ============================================
-- REMOVE: soft.*.penalty_multiplier (never used in code)
-- ============================================
DELETE FROM config WHERE config_key = 'penalty_multiplier' AND category = 'soft';

-- ============================================
-- REMOVE: Related config sections
-- ============================================
DELETE FROM config_sections WHERE section_key = 'priorities';
DELETE FROM config_sections WHERE section_key = 'friend-groups';
DELETE FROM config_sections WHERE section_key = 'spread-controls';

-- ============================================
-- VERIFY: Show what was removed
-- ============================================
SELECT 'Remaining configs: ' || COUNT(*) FROM config;
SELECT 'Remaining sections: ' || COUNT(*) FROM config_sections;
