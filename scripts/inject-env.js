#!/usr/bin/env node
// scripts/inject-env.js
// Runs at Vercel build time (buildCommand in vercel.json).
// Replaces __SUPABASE_URL__ and __SUPABASE_ANON_KEY__ tokens in HTML files.
// NEVER inject ANTHROPIC_API_KEY or SUPABASE_SERVICE_ROLE_KEY here.

const fs   = require('fs');
const path = require('path');

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌  Missing required environment variables:');
  if (!SUPABASE_URL)      console.error('   NEXT_PUBLIC_SUPABASE_URL');
  if (!SUPABASE_ANON_KEY) console.error('   NEXT_PUBLIC_SUPABASE_ANON_KEY');
  console.error('\nAdd these in Vercel → Project → Settings → Environment Variables.');
  process.exit(1);
}

function injectIntoFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/__SUPABASE_URL__/g,      SUPABASE_URL);
  content = content.replace(/__SUPABASE_ANON_KEY__/g,  SUPABASE_ANON_KEY);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`   ✅ Injected: ${path.basename(filePath)}`);
}

const publicDir = path.join(__dirname, '..', 'public');
injectIntoFile(path.join(publicDir, 'medcore-v3.html'));
injectIntoFile(path.join(publicDir, 'index.html'));

console.log('\n✅  Environment variables injected into HTML.');
console.log(`   Supabase URL:  ${SUPABASE_URL}`);
console.log(`   Anon key:      ${SUPABASE_ANON_KEY.slice(0, 20)}…`);
