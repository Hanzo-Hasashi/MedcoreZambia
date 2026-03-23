// check-storage-policies.js — Check and set up storage policies
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function checkStoragePolicies() {
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

  console.log('Checking storage bucket and policies...');

  try {
    // Check if bucket exists
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    if (bucketsError) throw bucketsError;

    const materialsBucket = buckets.find(b => b.id === 'materials');
    if (!materialsBucket) {
      console.log('Materials bucket not found, creating...');
      const { error: createError } = await supabase.storage.createBucket('materials', {
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
      if (createError) throw createError;
      console.log('✓ Bucket created');
    } else {
      console.log('✓ Bucket exists');
    }

    // Test upload with a small file to check permissions
    console.log('Testing upload permissions...');
    const testFile = new Blob(['test'], { type: 'text/plain' });
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('materials')
      .upload('test.txt', testFile, { upsert: true });

    if (uploadError) {
      console.error('Upload test failed:', uploadError);
      console.log('This indicates a permissions issue. The bucket policies may need to be configured.');
    } else {
      console.log('✓ Upload test successful');

      // Clean up test file
      await supabase.storage.from('materials').remove(['test.txt']);
      console.log('✓ Test file cleaned up');
    }

    console.log('Storage check completed');
  } catch (error) {
    console.error('Storage check failed:', error);
    process.exit(1);
  }
}

checkStoragePolicies();