-- Migration 0009: store the AI-content estimate (0-100) for each Part 2 answer.
-- Non-destructive: adds one nullable column. The app also self-heals this column
-- at runtime (ensurePart2AiCol), so it works even if this isn't applied.
ALTER TABLE part2_answers ADD COLUMN ai_content_pct REAL;
