// netlify/functions/carriers.js
const { createClient } = require('@supabase/supabase-js');

// Inizializza client Supabase con le variabili corrette
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Headers CORS per tutte le risposte
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

// ID organizzazione di default per test
const DEFAULT_ORG_ID = 'bb70d86e-bf38-4a85-adc3-76be46705d52';

// Handler principale della function
exports.handler = async (event, context) => {
  console.log('🚚 Carriers API called:', event.httpMethod, event.path);
  
  // Gestisci preflight CORS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    // Estrai organizzazione_id dal token JWT o usa default
    const organizzazione_id = await getOrganizzazioneId(event);
    console.log('🏢 Organization ID:', organizzazione_id);

    // Router per i diversi metodi HTTP
    switch (event.httpMethod) {
      case 'GET':
        return await handleGet(event, organizzazione_id);
      case 'POST':
        return await handlePost(event, organizzazione_id);
      case 'PUT':
        return await handlePut(event, organizzazione_id);
      case 'DELETE':
        return await handleDelete(event, organizzazione_id);
      default:
        return createResponse(405, { error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('❌ Error in carriers function:', error);
    return createResponse(500, { 
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// ===== Estrai organizzazione_id dal JWT o usa default =====
async function getOrganizzazioneId(event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('⚠️ No auth token found, using default organization');
      return DEFAULT_ORG_ID;
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Verifica il token e ottieni l'utente
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.log('⚠️ Invalid token, using default organization');
      return DEFAULT_ORG_ID;
    }

    // Ottieni organizzazione_id dal profilo
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organizzazione_id')
      .eq('id', user.id)
      .single();
    
    if (profileError || !profile?.organizzazione_id) {
      console.log('⚠️ No organization ID in profile, using default');
      return DEFAULT_ORG_ID;
    }

    return profile.organizzazione_id;
  } catch (error) {
    console.error('❌ Error extracting organization ID:', error);
    return DEFAULT_ORG_ID;
  }
}

// ===== GET - Ottieni corrieri =====
async function handleGet(event, organizzazione_id) {
  const { id } = event.queryStringParameters || {};
  
  try {
    if (id) {
      // Ottieni singolo corriere
      const { data, error } = await supabase
        .from('carriers') // Tabella in inglese
        .select('*')
        .eq('id', id)
        .eq('organizzazione_id', organizzazione_id)
        .single();

      if (error) throw error;
      
      if (!data) {
        return createResponse(404, { error: 'Carrier not found' });
      }

      return createResponse(200, data);
    } else {
      // Ottieni tutti i corrieri dell'organizzazione
      const { data, error } = await supabase
        .from('carriers') // Tabella in inglese
        .select('*')
        .eq('organizzazione_id', organizzazione_id)
        .order('name', { ascending: true });

      if (error) throw error;

      console.log(`✅ Retrieved ${data.length} carriers for org ${organizzazione_id}`);
      
      // Ritorna array diretto per compatibilità con il frontend
      return createResponse(200, data || []);
    }
  } catch (error) {
    console.error('❌ Error in GET:', error);
    throw error;
  }
}

// ===== POST - Crea nuovo corriere =====
async function handlePost(event, organizzazione_id) {
  try {
    const carrierData = JSON.parse(event.body);
    console.log('📦 Creating carrier:', carrierData.name);

    // Validazione dati obbligatori
    if (!carrierData.name || carrierData.name.trim() === '') {
      return createResponse(400, { 
        error: 'Carrier name is required' 
      });
    }

    // Prepara dati per inserimento con organizzazione_id
    const cleanData = {
      name: carrierData.name.trim(),
      code: carrierData.code?.trim() || null,
      contact_phone: carrierData.contact_phone?.trim() || null,
      contact_email: carrierData.contact_email?.trim() || null,
      website: carrierData.website?.trim() || null,
      notes: carrierData.notes?.trim() || null,
      is_active: carrierData.is_active !== false, // Default true
      shipping_types: carrierData.shipping_types || [],
      organizzazione_id: organizzazione_id
    };
    
    // Inserisci nel database
    const { data, error } = await supabase
      .from('carriers')
      .insert([cleanData])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return createResponse(409, { 
          error: 'Carrier already exists for this organization',
          code: 'DUPLICATE_CARRIER'
        });
      }
      throw error;
    }

    console.log('✅ Carrier created:', data.id, 'for org:', organizzazione_id);
    
    return createResponse(201, data);

  } catch (error) {
    console.error('❌ Error in POST:', error);
    
    if (error.message.includes('JSON')) {
      return createResponse(400, { error: 'Invalid JSON format' });
    }
    
    throw error;
  }
}

// ===== PUT - Aggiorna corriere =====
async function handlePut(event, organizzazione_id) {
  try {
    const carrierData = JSON.parse(event.body);
    const { id } = carrierData;

    if (!id) {
      return createResponse(400, { error: 'Carrier ID is required' });
    }

    console.log('📝 Updating carrier:', id);

    // Validazione nome
    if (carrierData.name !== undefined && carrierData.name.trim() === '') {
      return createResponse(400, { 
        error: 'Carrier name cannot be empty' 
      });
    }

    // Prepara dati per aggiornamento
    const updateData = {};
    
    // Aggiorna solo i campi forniti
    if (carrierData.name !== undefined) updateData.name = carrierData.name.trim();
    if (carrierData.code !== undefined) updateData.code = carrierData.code?.trim() || null;
    if (carrierData.contact_phone !== undefined) updateData.contact_phone = carrierData.contact_phone?.trim() || null;
    if (carrierData.contact_email !== undefined) updateData.contact_email = carrierData.contact_email?.trim() || null;
    if (carrierData.website !== undefined) updateData.website = carrierData.website?.trim() || null;
    if (carrierData.notes !== undefined) updateData.notes = carrierData.notes?.trim() || null;
    if (carrierData.is_active !== undefined) updateData.is_active = carrierData.is_active;
    if (carrierData.shipping_types !== undefined) updateData.shipping_types = carrierData.shipping_types;

    // Aggiungi timestamp
    updateData.updated_at = new Date().toISOString();

    // Aggiorna nel database solo per l'organizzazione corrente
    const { data, error } = await supabase
      .from('carriers')
      .update(updateData)
      .eq('id', id)
      .eq('organizzazione_id', organizzazione_id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return createResponse(409, { 
          error: 'Carrier already exists for this organization',
          code: 'DUPLICATE_CARRIER'
        });
      }
      throw error;
    }

    if (!data) {
      return createResponse(404, { error: 'Carrier not found or not authorized' });
    }

    console.log('✅ Carrier updated:', id, 'for org:', organizzazione_id);

    return createResponse(200, data);

  } catch (error) {
    console.error('❌ Error in PUT:', error);
    
    if (error.message.includes('JSON')) {
      return createResponse(400, { error: 'Invalid JSON format' });
    }
    
    throw error;
  }
}

// ===== DELETE - Elimina corriere =====
async function handleDelete(event, organizzazione_id) {
  try {
    const { id } = event.queryStringParameters || {};

    if (!id) {
      return createResponse(400, { error: 'Carrier ID is required' });
    }

    console.log('🗑️ Deleting carrier:', id);

    // Prima verifica che il corriere appartenga all'organizzazione
    const { data: existing, error: checkError } = await supabase
      .from('carriers')
      .select('id, name')
      .eq('id', id)
      .eq('organizzazione_id', organizzazione_id)
      .single();

    if (checkError || !existing) {
      return createResponse(404, { error: 'Carrier not found or not authorized' });
    }

    // Verifica se ci sono spedizioni associate
    const { count, error: countError } = await supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .eq('compagnia', existing.name) // Confronta per nome
      .eq('organizzazione_id', organizzazione_id);

    if (countError) throw countError;

    if (count > 0) {
      return createResponse(409, { 
        error: `Cannot delete: ${count} shipments are associated with this carrier`,
        code: 'HAS_SHIPMENTS'
      });
    }

    // Elimina dal database
    const { error } = await supabase
      .from('carriers')
      .delete()
      .eq('id', id)
      .eq('organizzazione_id', organizzazione_id);

    if (error) throw error;

    console.log('✅ Carrier deleted:', id, 'for org:', organizzazione_id);

    return createResponse(200, {
      message: 'Carrier deleted successfully',
      deletedId: id,
      deletedName: existing.name
    });

  } catch (error) {
    console.error('❌ Error in DELETE:', error);
    throw error;
  }
}

// ===== UTILITY FUNCTIONS =====

// Crea risposta HTTP standardizzata
function createResponse(statusCode, data) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(data, null, 2)
  };
}