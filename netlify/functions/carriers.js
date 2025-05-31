const { createClient } = require('@supabase/supabase-js');

// Inizializza client Supabase
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

    // Estrai organizzazione_id dai metadati dell'utente
    const organizzazione_id = user.app_metadata?.organizzazione_id || user.user_metadata?.organizzazione_id;
    
    if (!organizzazione_id) {
      console.log('⚠️ No organization ID in user metadata, using default');
      return DEFAULT_ORG_ID;
    }

    return organizzazione_id;
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
        .from('corrieri')
        .select('*')
        .eq('id', id)
        .eq('organizzazione_id', organizzazione_id)
        .single();

      if (error) throw error;
      
      if (!data) {
        return createResponse(404, { error: 'Corriere non trovato' });
      }

      return createResponse(200, data);
    } else {
      // Ottieni tutti i corrieri dell'organizzazione
      const { data, error } = await supabase
        .from('corrieri')
        .select('*')
        .eq('organizzazione_id', organizzazione_id)
        .order('nome', { ascending: true });

      if (error) throw error;

      console.log(`✅ Retrieved ${data.length} carriers for org ${organizzazione_id}`);
      
      return createResponse(200, {
        carriers: data,
        total: data.length,
        timestamp: new Date().toISOString()
      });
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
    console.log('📦 Creating carrier:', carrierData.nome);

    // Validazione dati obbligatori
    if (!carrierData.nome || carrierData.nome.trim() === '') {
      return createResponse(400, { 
        error: 'Nome corriere è obbligatorio' 
      });
    }

    // Prepara dati per inserimento con organizzazione_id
    const cleanData = {
      nome: carrierData.nome.trim(),
      codice: carrierData.codice?.trim() || null,
      telefono: carrierData.telefono?.trim() || null,
      email: carrierData.email?.trim() || null,
      sito_web: carrierData.sito_web?.trim() || null,
      note: carrierData.note?.trim() || null,
      attivo: carrierData.attivo !== false, // Default true
      organizzazione_id: organizzazione_id
    };
    
    // Inserisci nel database
    const { data, error } = await supabase
      .from('corrieri')
      .insert([cleanData])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return createResponse(409, { 
          error: 'Corriere già esistente per questa organizzazione',
          code: 'DUPLICATE_CARRIER'
        });
      }
      throw error;
    }

    console.log('✅ Carrier created:', data.id, 'for org:', organizzazione_id);
    
    return createResponse(201, {
      message: 'Corriere creato con successo',
      carrier: data
    });

  } catch (error) {
    console.error('❌ Error in POST:', error);
    
    if (error.message.includes('JSON')) {
      return createResponse(400, { error: 'Formato JSON non valido' });
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
      return createResponse(400, { error: 'ID corriere richiesto' });
    }

    console.log('📝 Updating carrier:', id);

    // Validazione nome
    if (carrierData.nome !== undefined && carrierData.nome.trim() === '') {
      return createResponse(400, { 
        error: 'Nome corriere non può essere vuoto' 
      });
    }

    // Prepara dati per aggiornamento
    const updateData = {};
    
    // Aggiorna solo i campi forniti
    if (carrierData.nome !== undefined) updateData.nome = carrierData.nome.trim();
    if (carrierData.codice !== undefined) updateData.codice = carrierData.codice?.trim() || null;
    if (carrierData.telefono !== undefined) updateData.telefono = carrierData.telefono?.trim() || null;
    if (carrierData.email !== undefined) updateData.email = carrierData.email?.trim() || null;
    if (carrierData.sito_web !== undefined) updateData.sito_web = carrierData.sito_web?.trim() || null;
    if (carrierData.note !== undefined) updateData.note = carrierData.note?.trim() || null;
    if (carrierData.attivo !== undefined) updateData.attivo = carrierData.attivo;

    // Aggiorna nel database solo per l'organizzazione corrente
    const { data, error } = await supabase
      .from('corrieri')
      .update(updateData)
      .eq('id', id)
      .eq('organizzazione_id', organizzazione_id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return createResponse(409, { 
          error: 'Corriere già esistente per questa organizzazione',
          code: 'DUPLICATE_CARRIER'
        });
      }
      throw error;
    }

    if (!data) {
      return createResponse(404, { error: 'Corriere non trovato o non autorizzato' });
    }

    console.log('✅ Carrier updated:', id, 'for org:', organizzazione_id);

    return createResponse(200, {
      message: 'Corriere aggiornato con successo',
      carrier: data
    });

  } catch (error) {
    console.error('❌ Error in PUT:', error);
    
    if (error.message.includes('JSON')) {
      return createResponse(400, { error: 'Formato JSON non valido' });
    }
    
    throw error;
  }
}

// ===== DELETE - Elimina corriere =====
async function handleDelete(event, organizzazione_id) {
  try {
    const { id } = event.queryStringParameters || {};

    if (!id) {
      return createResponse(400, { error: 'ID corriere richiesto' });
    }

    console.log('🗑️ Deleting carrier:', id);

    // Prima verifica che il corriere appartenga all'organizzazione
    const { data: existing, error: checkError } = await supabase
      .from('corrieri')
      .select('id, nome')
      .eq('id', id)
      .eq('organizzazione_id', organizzazione_id)
      .single();

    if (checkError || !existing) {
      return createResponse(404, { error: 'Corriere non trovato o non autorizzato' });
    }

    // Verifica se ci sono spedizioni associate
    const { count, error: countError } = await supabase
      .from('spedizioni')
      .select('id', { count: 'exact', head: true })
      .eq('corriere_id', id)
      .eq('organizzazione_id', organizzazione_id);

    if (countError) throw countError;

    if (count > 0) {
      return createResponse(409, { 
        error: `Impossibile eliminare: ci sono ${count} spedizioni associate a questo corriere`,
        code: 'HAS_SHIPMENTS'
      });
    }

    // Elimina dal database
    const { error } = await supabase
      .from('corrieri')
      .delete()
      .eq('id', id)
      .eq('organizzazione_id', organizzazione_id);

    if (error) throw error;

    console.log('✅ Carrier deleted:', id, 'for org:', organizzazione_id);

    return createResponse(200, {
      message: 'Corriere eliminato con successo',
      deletedId: id,
      deletedName: existing.nome
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