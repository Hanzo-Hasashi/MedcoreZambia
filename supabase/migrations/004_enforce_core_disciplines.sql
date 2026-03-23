-- ============================================================
-- MedCore Zambia — Enforce 10 Core Disciplines + wipe non-core materials
-- Run after 003_notifications.sql
-- ============================================================

-- Core discipline set; each subject is allowed as the source of truth.
WITH core(name, slug, emoji, description, color_from, color_to, chip_class, sort_order) AS (
  VALUES
    ('Internal Medicine','internal-medicine','🩺','Comprehensive adult medical care.', '#18324f','#1a4a72','chip-forest',0),
    ('Pediatrics','pediatrics','👶','Child health and disease management.', '#1f4f3c','#2f8f5f','chip-forest',1),
    ('Obstetrics and Gynecology','obstetrics-gynecology','🤰','Pregnancy, childbirth, and women''s reproductive health.', '#5a2e3f','#934f6b','chip-crim',2),
    ('Surgery','surgery','🔪','Surgical disciplines including perioperative care.', '#4f2a1a','#8e5233','chip-amber',3),
    ('Anatomy','anatomy','🦴','Structural foundations of the human body.', '#1a4332','#0f2a1e','chip-forest',4),
    ('Physiology','physiology','❤️','Function and systems control in the human body.', '#0d2a20','#071a13','chip-forest',5),
    ('Biochemistry','biochemistry','🧬','Molecular and metabolic pathways.', '#1a1a4a','#0d0d2e','chip-sapp',6),
    ('Pharmacology','pharmacology','💊','Drug mechanisms and therapeutics.', '#0a2a2a','#051515','chip-amber',7),
    ('Microbiology','microbiology','🦠','Infectious agents and host interactions.', '#0d2a0d','#071507','chip-forest',8),
    ('Clinical Skills','clinical-skills','🏥','Examination, communication and procedural skills.', '#2e1a2d','#4f3152','chip-crim',9)
)
-- Insert core subjects idempotently
INSERT INTO public.subjects (name, slug, emoji, description, color_from, color_to, chip_class, sort_order)
SELECT name, slug, emoji, description, color_from, color_to, chip_class, sort_order
FROM core
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      emoji = EXCLUDED.emoji,
      description = EXCLUDED.description,
      color_from = EXCLUDED.color_from,
      color_to = EXCLUDED.color_to,
      chip_class = EXCLUDED.chip_class,
      sort_order = EXCLUDED.sort_order,
      updated_at = NOW();

-- Keep existing subjects/materials/recommendations to support custom curricula.
-- The legacy core discipline cleanup has been removed to avoid accidentally deleting non-core data.
-- If strict core-only enforcement is required, re-enable filtering with explicit review.

-- Remove all materials/recommendations that have missing or invalid subject reference (data hygiene)
DELETE FROM public.materials
WHERE subject IS NULL
   OR NOT EXISTS (SELECT 1 FROM public.subjects WHERE slug = public.materials.subject);

DELETE FROM public.recommendations
WHERE subject IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.subjects WHERE slug = public.recommendations.subject);

-- Validation trigger: ensure materials/recommendations reference existing subject slug.
CREATE OR REPLACE FUNCTION public.validate_subject_slug_exists()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.subject IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.subjects WHERE slug = NEW.subject
  ) THEN
    RAISE EXCEPTION 'Invalid subject: % (must exist in subjects table)', NEW.subject;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS materials_validate_subject ON public.materials;
CREATE TRIGGER materials_validate_subject
  BEFORE INSERT OR UPDATE ON public.materials
  FOR EACH ROW EXECUTE FUNCTION public.validate_subject_slug_exists();

DROP TRIGGER IF EXISTS recommendations_validate_subject ON public.recommendations;
CREATE TRIGGER recommendations_validate_subject
  BEFORE INSERT OR UPDATE ON public.recommendations
  FOR EACH ROW EXECUTE FUNCTION public.validate_subject_slug_exists();
