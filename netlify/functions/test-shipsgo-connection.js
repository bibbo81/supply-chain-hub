// netlify/functions/test-shipsgo-connection.js
// SOLUZIONE PULITA - Niente workaround

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event, context) => {
  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { v1Key, v2Token } = body;

    const results = {
      v1: { 
        success: false, 
        message: v1Key ? 'Testing...' : 'No API key provided',
        info: null 
      },
      v2: { 
        success: false, 
        message: v2Token ? 'Testing...' : 'No API token provided',
        info: null 
      }
    };

    // Test v1.2 API - APPROCCIO ONESTO
    if (v1Key) {
      results.v1.message = '⚠️ ShipsGo v1.2 non fornisce un endpoint di validazione';
      results.v1.info = 'La chiave verrà validata al primo utilizzo effettivo';
      results.v1.success = null; // Non false, ma null = non determinabile
    }

    // Test v2.0 API - Questo ha un endpoint reale
    if (v2Token) {
      try {
        const v2Response = await fetch(
          'https://api.shipsgo.com/v2/air/shipments?take=1', // ✅ URL CORRETTO
          {
            method: 'GET',
            headers: {
              'X-Shipsgo-User-Token': v2Token, // ✅ HEADER CORRETTO
              'Accept': 'application/json'
            }
          }
        );
        
        if (v2Response.ok) {
          const v2Data = await v2Response.json();
          results.v2.success = true;
          results.v2.message = '✅ Token valido';
          results.v2.info = {
            totalShipments: v2Data.total || 0,
            accountActive: true
          };
        } else if (v2Response.status === 401) {
          results.v2.success = false;
          results.v2.message = '❌ Token non valido o scaduto';
        } else {
          results.v2.success = false;
          results.v2.message = `❌ Errore API: ${v2Response.status}`;
        }
      } catch (error) {
        results.v2.success = false;
        results.v2.message = '❌ Errore di connessione: ' + error.message;
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(results)
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
        message: error.message 
      })
    };
  }
};
