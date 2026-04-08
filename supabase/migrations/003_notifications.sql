-- ============================================================
-- MedCore Zambia — Notifications System Migration
-- Run after 002_content_tables.sql
-- ============================================================

-- ── NOTIFICATIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('new_material', 'new_quiz', 'new_lesson', 'recommendation', 'system')),
  title        TEXT NOT NULL,
  message      TEXT NOT NULL,
  related_id   UUID,                          -- optional: lesson_id, material_id, etc.
  related_type TEXT,                          -- 'lesson', 'material', 'quiz', etc.
  is_read      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY "Users read own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "System creates notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (TRUE);

CREATE POLICY "Users update own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_user   ON public.notifications(user_id, created_at DESC, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type   ON public.notifications(type, created_at DESC);