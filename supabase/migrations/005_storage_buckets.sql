-- ============================================================
-- MedCore Zambia — Storage Buckets Setup
-- Creates the 'materials' bucket for file uploads
-- ============================================================

-- Create the materials storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'materials',
  'materials',
  false, -- not public
  52428800, -- 50MB limit
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/gif',
    'video/mp4',
    'video/avi',
    'video/mov'
  ]
) ON CONFLICT (id) DO NOTHING;

-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can view materials (for downloads)
CREATE POLICY "Public access to materials"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'materials');

-- Policy: Only authenticated users can upload to materials
CREATE POLICY "Authenticated users can upload materials"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'materials' AND
    auth.role() = 'authenticated'
  );

-- Policy: Only admins can delete materials
CREATE POLICY "Admins can delete materials"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'materials' AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Policy: Only admins can update materials
CREATE POLICY "Admins can update materials"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'materials' AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );