// netlify/functions/test-shipsgo-connection.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Funzione per ottenere configurazione ShipsGo dinamica
async function getShipsGoConfig(userId) {
  const config = {
    v1: { 
      apiKey: process.env.SHIPSGO_API_KEY,
      configured: false 
    },
    v2: { 
      token: process.env.SHIPSGO_V2_TOKEN,
      configured: false 
    }
  };
  
  // Prova a prendere dal profilo utente
  if (userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('api_settings')
      .eq('id', userId)
      .single();
      
    if (profile?.api_settings) {
      if (profile.api_settings.shipsgo_v1_key) {
        config.v1.apiKey = Buffer.from(profile.api_settings.shipsgo_v1_key, 'base64').toString();
        config.v1.configured = true;
      }
      if (profile.api_settings.shipsgo_v2_token) {
        config.v2.token = Buffer.from(profile.api_settings.shipsgo_v2_token, 'base64').toString();
        config.v2.configured = true;
      }
    }
  }
  
  // Fallback defaults
  if (!config.v1.apiKey) {
    config.v1.apiKey = '2dc0c6d92ccb59e7d903825c4ebeb521';
  }
  if (!config.v2.token) {
    config.v2.token = '505751c2-2745-4d83-b4e7-d35ccddd0628';
  }
  
  return config;
}

exports.handler = async (event, context) => {
  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Get user if authenticated
    let userId = null;
    const token = event.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) userId = user.id;
    }

    // Get configuration
    const config = await getShipsGoConfig(userId);
    const results = {
      v1: { status: '⏭️ Non configurato', configured: config.v1.configured },
      v2: { status: '⏭️ Non configurato', configured: config.v2.configured }
    };

    // Test v1.2 API
    if (config.v1.apiKey) {
      try {
        const v1Response = await fetch(
          `https://shipsgo.com/api/v1.2/ContainerService/GetContainerInfo/?authCode=${config.v1.apiKey}`,
          { method: 'GET' }
        );
        
        if (v1Response.status === 401) {
          results.v1.status = '❌ API Key non valida';
        } else if (v1Response.status === 400 || v1Response.status === 404) {
          results.v1.status = '✅ API Key valida (test richiede container ID)';
        } else if (v1Response.ok) {
          results.v1.status = '✅ Connessione OK';
        } else {
          results.v1.status = '⚠️ Errore connessione';
        }
      } catch (error) {
        results.v1.status = '❌ Errore di rete';
        results.v1.error = error.message;
      }
    }

    // Test v2.0 API
    if (config.v2.token) {
      try {
        const v2Response = await fetch(
          'https://api.shipsgo.com/v2/air/shipments?take=1',
          {
            headers: {
              'Authorization': `Bearer ${config.v2.token}`,
              'Accept': 'application/json'
            }
          }
        );
        
        if (v2Response.status === 401) {
          results.v2.status = '❌ Bearer Token non valido';
        } else if (v2Response.ok) {
          results.v2.status = '✅ Connessione OK';
        } else {
          results.v2.status = '⚠️ Errore connessione';
          const errorText = await v2Response.text();
          results.v2.error = errorText;
        }
      } catch (error) {
        results.v2.status = '❌ Errore di rete';
        results.v2.error = error.message;
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        results: results,
        hasUserConfig: !!userId
      })
    };

  } catch (error) {
    console.error('Test connection error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      })
    };
  }
};