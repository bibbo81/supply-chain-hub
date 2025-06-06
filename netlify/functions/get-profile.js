const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  // Define CORS headers at the beginning of the function
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  console.log('📝 Get Profile API called:', event.httpMethod);

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Only GET allowed
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Extract auth token from header or query params
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let userId = event.queryStringParameters?.id;
    
    // Try to get user from token if provided
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      
      if (!authError && user) {
        userId = user.id;
      }
    }
    
    if (!userId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'User ID richiesto' })
      };
    }

    console.log('👤 Fetching profile for user:', userId);

    // Get profile from profiles table
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Supabase error:', error);
      
      // If profile doesn't exist, create it
      if (error.code === 'PGRST116') {
        const { data: newProfile, error: createError } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            email: '', // Will be updated later
            api_settings: {},
            created_at: new Date().toISOString()
          })
          .select()
          .single();
          
        if (createError) {
          return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
              error: 'Errore creazione profilo',
              details: createError.message 
            })
          };
        }
        
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify(newProfile)
        };
      }
      
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Profilo non trovato',
          details: error.message 
        })
      };
    }

    console.log('Profile fetched successfully');
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(profile)
    };

  } catch (error) {
    console.error('❌ Handler error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Errore interno del server',
        details: error.message 
      })
    };
  }
};