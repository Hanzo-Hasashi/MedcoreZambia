// create-storage-bucket.js — Create the materials storage bucket
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function createStorageBucket() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  console.log('Creating materials storage bucket...');

  try {
    // Create the bucket
    const { data: bucketData, error: bucketError } = await supabase.storage.createBucket('materials', {
      public: false,
      fileSizeLimit: 52428800, // 50MB
      allowedMimeTypes: [
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
    });

    if (bucketError) {
      if (bucketError.message.includes('already exists')) {
        console.log('✓ Bucket already exists');
      } else {
        throw bucketError;
      }
    } else {
      console.log('✓ Bucket created successfully');
    }

    console.log('Storage bucket setup completed');
  } catch (error) {
    console.error('Failed to create storage bucket:', error);
    process.exit(1);
  }
}

createStorageBucket();