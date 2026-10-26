-- Questions may now have a word limit of up to 10,000 words (was 3,000).
-- The Worker also makes this change itself on first use, so applying this file
-- before or after a deploy is safe either way.
DROP TRIGGER IF EXISTS trg_question_bank_ins;
CREATE TRIGGER trg_question_bank_ins
BEFORE INSERT ON question_bank
WHEN NEW.marks <= 0 OR (NEW.word_limit IS NOT NULL AND (NEW.word_limit < 50 OR NEW.word_limit > 10000))
BEGIN SELECT RAISE(ABORT, 'invalid marks or word limit'); END;

DROP TRIGGER IF EXISTS trg_question_bank_upd;
CREATE TRIGGER trg_question_bank_upd
BEFORE UPDATE OF marks, word_limit ON question_bank
WHEN NEW.marks <= 0 OR (NEW.word_limit IS NOT NULL AND (NEW.word_limit < 50 OR NEW.word_limit > 10000))
BEGIN SELECT RAISE(ABORT, 'invalid marks or word limit'); END;
