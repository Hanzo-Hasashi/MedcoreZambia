-- ============================================================
-- MedCore Zambia — Lesson Sections/Content Table
-- Stores structured lesson content (key facts, sections, etc.)
-- ============================================================

-- ── LESSON SECTIONS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lesson_sections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id    UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL CHECK (section_type IN ('key_facts', 'section', 'content')),
  -- section_type: 'key_facts' = Key Fact highlight
  --               'section' = Titled section (like "Four Chambers")
  --               'content' = General paragraph/text
  title        TEXT,                          -- for 'section' type only
  content      TEXT NOT NULL,                 -- markdown or plain text
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.lesson_sections ENABLE ROW LEVEL SECURITY;

-- Everyone reads sections for active lessons
CREATE POLICY "Everyone reads lesson sections for active lessons"
  ON public.lesson_sections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE l.id = lesson_id AND l.is_active = TRUE
    )
  );

-- Admins manage all sections
CREATE POLICY "Admins manage lesson sections"
  ON public.lesson_sections FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_lesson_sections_lesson ON public.lesson_sections(lesson_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lesson_sections_type   ON public.lesson_sections(lesson_id, section_type);

-- Update timestamp trigger
CREATE TRIGGER lesson_sections_updated_at BEFORE UPDATE ON public.lesson_sections 
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
