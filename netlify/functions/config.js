// netlify/functions/config.js
// Endpoint per fornire la configurazione pubblica di Supabase

const handler = async (event, context) => {
  // Gestione CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Gestione preflight OPTIONS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Solo GET è permesso
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Debug: logghiamo le variabili disponibili
    console.log('Environment variables check:');
    console.log('VITE_SUPABASE_URL exists:', !!process.env.VITE_SUPABASE_URL);
    console.log('VITE_SUPABASE_ANON_KEY exists:', !!process.env.VITE_SUPABASE_ANON_KEY);
    
    // Controlliamo se le variabili d'ambiente esistono
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Missing environment variables');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Configuration not available',
          debug: {
            hasUrl: !!supabaseUrl,
            hasKey: !!supabaseAnonKey
          }
        })
      };
    }

    // Ritorniamo la configurazione nel formato atteso dal frontend
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        SUPABASE_URL: supabaseUrl,
        SUPABASE_ANON_KEY: supabaseAnonKey
      })
    };

  } catch (error) {
    console.error('Config function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      })
    };
  }
};

// Esportiamo la funzione handler
module.exports = { handler };