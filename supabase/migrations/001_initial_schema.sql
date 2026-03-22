-- ============================================================
-- MedCore Zambia — Supabase Schema
-- Run this in Supabase SQL editor or via supabase db push
-- ============================================================

-- Enable Row Level Security on all tables

-- ── PROFILES ─────────────────────────────────────────────────
-- Mirrors auth.users; populated on first sign-in via trigger
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT,
  role        TEXT NOT NULL DEFAULT 'student'
                CHECK (role IN ('student','admin')),
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','active','free')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile; admins can read all
CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins read all profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

CREATE POLICY "Admins update all profiles"
  ON public.profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Service role can insert (used by trigger)
CREATE POLICY "Service role insert profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (TRUE);

-- ── USER PROGRESS ────────────────────────────────────────────
-- Stores XP, streaks, quiz history, subject progress per user
CREATE TABLE IF NOT EXISTS public.user_progress (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  xp              INTEGER NOT NULL DEFAULT 0,
  streak          INTEGER NOT NULL DEFAULT 0,
  best_streak     INTEGER NOT NULL DEFAULT 0,
  card_reviews    INTEGER NOT NULL DEFAULT 0,
  ai_questions    INTEGER NOT NULL DEFAULT 0,
  lessons_done    INTEGER NOT NULL DEFAULT 0,
  last_study_date DATE,
  subject_progress JSONB NOT NULL DEFAULT '{
    "anatomy":0,"physiology":0,"biochemistry":0,
    "pathology":0,"pharmacology":0,"microbiology":0,"clinical":0
  }'::jsonb,
  quiz_history    JSONB NOT NULL DEFAULT '[]'::jsonb,
  flashcards      JSONB,
  settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own progress"
  ON public.user_progress FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins read all progress"
  ON public.user_progress FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- ── COMPLETED LESSONS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.completed_lessons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id   INTEGER NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, lesson_id)
);

ALTER TABLE public.completed_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own lessons"
  ON public.completed_lessons FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── MATERIALS (admin-managed) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.materials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  type        TEXT NOT NULL,   -- 'past_paper', 'note', 'osce', 'solution'
  content_url TEXT,
  description TEXT,
  premium     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone reads free materials"
  ON public.materials FOR SELECT
  USING (premium = FALSE);

CREATE POLICY "Paid users read premium materials"
  ON public.materials FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.status = 'active')
    )
  );

CREATE POLICY "Admins manage materials"
  ON public.materials FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- ── RECOMMENDATIONS (admin-managed) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.recommendations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  subject     TEXT,
  link        TEXT,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read recommendations"
  ON public.recommendations FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins manage recommendations"
  ON public.recommendations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- ── TRIGGER: auto-create profile on sign-up ──────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  admin_emails TEXT[] := ARRAY[
    'admin@medcore.app',
    'ethernity@medcore.app'
    -- Add more admin emails here
  ];
  is_admin BOOLEAN;
BEGIN
  is_admin := NEW.email = ANY(admin_emails);

  INSERT INTO public.profiles (id, email, name, role, status)
  VALUES (
    NEW.id,
    LOWER(NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    CASE WHEN is_admin THEN 'admin' ELSE 'student' END,
    CASE WHEN is_admin THEN 'active' ELSE 'pending' END
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_progress (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── TRIGGER: keep updated_at current ─────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER progress_updated_at
  BEFORE UPDATE ON public.user_progress
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role  ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_progress_user  ON public.user_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_lessons_user   ON public.completed_lessons(user_id);
CREATE INDEX IF NOT EXISTS idx_materials_subj ON public.materials(subject);
