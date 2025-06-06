// netlify/functions/test-shipsgo-connection.js
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
    // Parse body per ottenere le keys da testare
    const body = JSON.parse(event.body);
    const { v1Key, v2Token } = body;

    const results = {
      v1: { 
        success: false, 
        message: v1Key ? 'Testing...' : 'No API key provided',
        credits: null 
      },
      v2: { 
        success: false, 
        message: v2Token ? 'Testing...' : 'No API token provided',
        shipments: null 
      }
    };

    // Test v1.2 API (Container tracking)
    if (v1Key) {
      try {
        // Test con GetMyCredits per verificare la validità
        const formData = new URLSearchParams();
        formData.append('authCode', v1Key);

        const v1Response = await fetch(
          'https://shipsgo.com/api/v1.2/GetMyCredits',
          { 
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Accept': 'application/json'
            },
            body: formData.toString()
          }
        );
        
        const v1Data = await v1Response.json();
        
        if (v1Response.ok && (v1Data.success || v1Data.Credits !== undefined)) {
          results.v1.success = true;
          results.v1.message = '✅ API Key valida';
          results.v1.credits = v1Data.Credits || v1Data.credits || 0;
        } else {
          results.v1.success = false;
          results.v1.message = '❌ API Key non valida';
          if (v1Data.message) {
            results.v1.message += ': ' + v1Data.message;
          }
        }
      } catch (error) {
        results.v1.success = false;
        results.v1.message = '❌ Errore di connessione: ' + error.message;
      }
    }

    // Test v2.0 API (Air tracking)
    if (v2Token) {
      try {
        const v2Response = await fetch(
          'https://shipsgo.com/api/v2.0/shipments/air?take=1',
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${v2Token}`,
              'Accept': 'application/json'
            }
          }
        );
        
        if (v2Response.ok) {
          const v2Data = await v2Response.json();
          results.v2.success = true;
          results.v2.message = '✅ Token valido';
          results.v2.shipments = v2Data.total || 0;
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