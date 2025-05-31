// netlify/functions/create-organization.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY; // Use service key for admin operations
  
  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing configuration' })
    };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { nome_azienda, email } = JSON.parse(event.body);
    
    if (!nome_azienda || !email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Nome azienda ed email sono richiesti' })
      };
    }

    // Create the organization
    const { data: orgData, error: orgError } = await supabase
      .from('organizzazioni')
      .insert({
        nome_azienda: nome_azienda,
        piano: 'free',
        limite_utenti: 5,
        limite_spedizioni_mese: 100,
        features: {
          import_csv: true,
          import_excel: false,
          api_access: false,
          notifications: false
        },
        attiva: true,
        data_scadenza_trial: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single();
    
    if (orgError) {
      console.error('Organization creation error:', orgError);
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Errore nella creazione dell\'organizzazione',
          details: orgError.message 
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        success: true,
        organizationId: orgData.id,
        message: 'Organizzazione creata con successo' 
      })
    };

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Errore interno del server',
        details: error.message 
      })
    };
  }
};