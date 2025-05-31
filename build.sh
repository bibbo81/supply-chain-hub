#!/bin/bash

# build.sh - Netlify build script
# This script replaces placeholders with actual environment variables

echo "Building Supply Chain Hub..."

# Create config.js with actual environment variables
cat > public/config.js << EOF
// Auto-generated configuration file
window.SUPABASE_URL = '${VITE_SUPABASE_URL}';
window.SUPABASE_ANON_KEY = '${VITE_SUPABASE_ANON_KEY}';
EOF

echo "Configuration file created successfully"

# If you have other build steps, add them here
# npm run build (if needed)