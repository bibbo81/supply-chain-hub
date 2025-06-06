// netlify/functions/update-profile.js
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client with service key
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  console.log('📝 Update Profile API called:', event.httpMethod);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Only POST allowed
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Extract auth token
    const authHeader = event.headers.authorization || event.headers.Authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Token di autenticazione mancante' })
      };
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Verify token and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Auth error:', authError);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Token non valido o scaduto' })
      };
    }

    console.log('👤 User authenticated:', user.id);

    // Parse request body
    const requestData = JSON.parse(event.body);
    const { action, data } = requestData;

    // Handle different actions
    switch (action) {
      case 'update_profile':
        return await handleUpdateProfile(user, data);
      
      case 'upload_avatar':
        return await handleUploadAvatar(user, data);
      
      case 'change_password':
        return await handleChangePassword(user, data, token);
      
      case 'update_preferences':
        return await handleUpdatePreferences(user, data);
      
      case 'update_api_settings':
        return await handleUpdateApiSettings(user, data);
      
      default:
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Azione non valida' })
        };
    }

  } catch (error) {
    console.error('❌ Error in update-profile:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Errore interno del server',
        message: error.message 
      })
    };
  }
};

// Handle profile update
async function handleUpdateProfile(user, data) {
  try {
    const { firstName, lastName, phone, jobTitle, bio } = data;

    // Validate required fields
    if (!firstName || !lastName) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Nome e cognome sono obbligatori' })
      };
    }

    // Update user metadata
    const { data: updatedUser, error } = await supabase.auth.admin.updateUserById(
      user.id,
      {
        user_metadata: {
          ...user.user_metadata,
          full_name: `${firstName} ${lastName}`,
          display_name: `${firstName} ${lastName}`,
          first_name: firstName,
          last_name: lastName,
          phone: phone || null,
          job_title: jobTitle || null,
          bio: bio || null,
          updated_at: new Date().toISOString()
        }
      }
    );

    if (error) {
      console.error('Update error:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Errore durante l\'aggiornamento del profilo' })
      };
    }

    // Log the update
    await logActivity(user.id, 'profile_updated', {
      fields_updated: Object.keys(data).filter(k => data[k] !== undefined)
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Profilo aggiornato con successo',
        user: {
          id: updatedUser.user.id,
          email: updatedUser.user.email,
          user_metadata: updatedUser.user.user_metadata
        }
      })
    };

  } catch (error) {
    console.error('Profile update error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message })
    };
  }
}

// Handle avatar upload
async function handleUploadAvatar(user, data) {
  try {
    const { avatarBase64, fileName } = data;

    if (!avatarBase64) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Nessuna immagine fornita' })
      };
    }

    // First, create the avatars bucket if it doesn't exist
    const { data: buckets } = await supabase.storage.listBuckets();
    const avatarsBucketExists = buckets?.some(bucket => bucket.name === 'avatars');
    
    if (!avatarsBucketExists) {
      console.log('Creating avatars bucket...');
      const { error: bucketError } = await supabase.storage.createBucket('avatars', {
        public: true,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        fileSizeLimit: 5242880 // 5MB
      });
      
      if (bucketError && !bucketError.message.includes('already exists')) {
        console.error('Bucket creation error:', bucketError);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Errore nella creazione del bucket avatars' })
        };
      }
    }

    // Convert base64 to buffer
    const base64Data = avatarBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Generate unique filename
    const extension = fileName?.split('.').pop() || 'jpg';
    const avatarFileName = `${user.id}/avatar-${Date.now()}.${extension}`;

    // Delete old avatar if exists
    const oldAvatarUrl = user.user_metadata?.avatar_url;
    if (oldAvatarUrl) {
      const oldPath = oldAvatarUrl.split('/').slice(-2).join('/');
      await supabase.storage.from('avatars').remove([oldPath]);
    }

    // Upload new avatar
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(avatarFileName, buffer, {
        contentType: `image/${extension}`,
        upsert: true
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Errore durante il caricamento dell\'avatar' })
      };
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(avatarFileName);

    // Update user metadata with avatar URL
    const { data: updatedUser, error: updateError } = await supabase.auth.admin.updateUserById(
      user.id,
      {
        user_metadata: {
          ...user.user_metadata,
          avatar_url: publicUrl
        }
      }
    );

    if (updateError) {
      console.error('User update error:', updateError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Errore durante l\'aggiornamento del profilo' })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Avatar aggiornato con successo',
        avatar_url: publicUrl
      })
    };

  } catch (error) {
    console.error('Avatar upload error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message })
    };
  }
}

// Handle password change
async function handleChangePassword(user, data, token) {
  try {
    const { currentPassword, newPassword } = data;

    if (!currentPassword || !newPassword) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Password attuale e nuova sono obbligatorie' })
      };
    }

    // Validate password strength
    if (!isPasswordValid(newPassword)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'La password non soddisfa i requisiti di sicurezza',
          requirements: {
            minLength: 8,
            requireUppercase: true,
            requireLowercase: true,
            requireNumbers: true,
            requireSpecialChars: true
          }
        })
      };
    }

    // First, verify current password by trying to sign in
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword
    });

    if (signInError) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Password attuale non corretta' })
      };
    }

    // Update password
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (updateError) {
      console.error('Password update error:', updateError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Errore durante l\'aggiornamento della password' })
      };
    }

    // Log the password change
    await logActivity(user.id, 'password_changed', {
      ip: 'unknown'
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Password aggiornata con successo'
      })
    };

  } catch (error) {
    console.error('Password change error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message })
    };
  }
}

// Handle preferences update
async function handleUpdatePreferences(user, data) {
  try {
    const { 
      emailNotifications, 
      desktopNotifications, 
      weeklyReports, 
      darkMode 
    } = data;

    // Update user metadata with preferences
    const { data: updatedUser, error } = await supabase.auth.admin.updateUserById(
      user.id,
      {
        user_metadata: {
          ...user.user_metadata,
          preferences: {
            email_notifications: emailNotifications ?? true,
            desktop_notifications: desktopNotifications ?? false,
            weekly_reports: weeklyReports ?? true,
            dark_mode: darkMode ?? true
          }
        }
      }
    );

    if (error) {
      console.error('Preferences update error:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Errore durante l\'aggiornamento delle preferenze' })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Preferenze aggiornate con successo',
        preferences: updatedUser.user.user_metadata.preferences
      })
    };

  } catch (error) {
    console.error('Preferences update error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message })
    };
  }
}

// Handle API settings update
async function handleUpdateApiSettings(user, data) {
  try {
    const { api_settings } = data;
    
    if (!api_settings || typeof api_settings !== 'object') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'API settings non valide' })
      };
    }

    // Update profiles table with api_settings
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        api_settings: api_settings,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('API settings update error:', updateError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Errore durante l\'aggiornamento delle API settings' })
      };
    }

    // Log the update
    await logActivity(user.id, 'api_settings_updated', {
      keys_updated: Object.keys(api_settings)
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'API settings aggiornate con successo'
      })
    };

  } catch (error) {
    console.error('API settings update error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message })
    };
  }
}

// Validate password strength
function isPasswordValid(password) {
  if (password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) return false;
  return true;
}

// Log user activity
async function logActivity(userId, action, details = {}) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action,
      details,
      ip_address: details.ip || 'unknown',
      user_agent: details.user_agent || 'unknown',
      created_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error logging activity:', error);
    // Don't throw - logging shouldn't break the main operation
  }
}

// Helper to create response
function createResponse(statusCode, data) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(data, null, 2)
  };
}