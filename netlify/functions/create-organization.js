// netlify/functions/create-organization.js
const { createClient } = require('@supabase/supabase-js');

const handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only POST allowed
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse request body
    const { nome_azienda, email } = JSON.parse(event.body);

    if (!nome_azienda || !email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Nome azienda ed email richiesti' })
      };
    }

    // Initialize Supabase with service key
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase configuration');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Create organization
    const { data: org, error: orgError } = await supabase
      .from('organizzazioni')
      .insert({
        nome_azienda,
        piano: 'free',
        limite_utenti: 5,
        limite_spedizioni_mese: 100,
        features: {
          import_csv: true,
          export_data: true,
          api_access: false,
          multi_warehouse: false,
          tracking_avanzato: false,
          notifiche_email: true,
          report_personalizzati: false,
          integrazioni_corrieri: 1
        },
        attiva: true,
        settings: {
          tema: 'light',
          lingua: 'it',
          timezone: 'Europe/Rome',
          formato_data: 'DD/MM/YYYY',
          valuta: 'EUR',
          notifiche: {
            email_spedizioni: true,
            email_report: false,
            webhook_eventi: false
          }
        },
        data_scadenza_trial: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single();

    if (orgError) {
      console.error('Error creating organization:', orgError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Errore creazione organizzazione',
          details: orgError.message 
        })
      };
    }

    console.log('Organization created:', org.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        organizationId: org.id,
        message: 'Organizzazione creata con successo'
      })
    };

  } catch (error) {
    console.error('Create organization error:', error);
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

module.exports = { handler };