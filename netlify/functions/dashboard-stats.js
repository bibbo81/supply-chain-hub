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
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

// ID organizzazione di default per test
const DEFAULT_ORG_ID = 'bb70d86e-bf38-4a85-adc3-76be46705d52';

// Handler principale della function
exports.handler = async (event, context) => {
  console.log('📊 Dashboard Stats API called:', event.httpMethod);
  
  // Gestisci preflight CORS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  // Solo GET è permesso
  if (event.httpMethod !== 'GET') {
    return createResponse(405, { error: 'Method not allowed' });
  }

  try {
    // Estrai organizzazione_id dal token JWT o usa default
    const organizzazione_id = await getOrganizzazioneId(event);
    console.log('🏢 Organization ID:', organizzazione_id);

    // Calcola tutte le statistiche per l'organizzazione
    const stats = await calculateDashboardStats(organizzazione_id);
    
    return createResponse(200, stats);
  } catch (error) {
    console.error('❌ Error in dashboard-stats function:', error);
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

// ===== Calcola tutte le statistiche dashboard =====
async function calculateDashboardStats(organizzazione_id) {
  console.log('📈 Calculating stats for organization:', organizzazione_id);
  
  // Esegui tutte le query in parallelo per performance
  const [
    totalShipments,
    shipmentsByStatus,
    shipmentsByType,
    monthlyTrend,
    topSuppliers,
    topCarriers,
    costAnalysis,
    delayAnalysis
  ] = await Promise.all([
    getTotalShipments(organizzazione_id),
    getShipmentsByStatus(organizzazione_id),
    getShipmentsByType(organizzazione_id),
    getMonthlyTrend(organizzazione_id),
    getTopSuppliers(organizzazione_id),
    getTopCarriers(organizzazione_id),
    getCostAnalysis(organizzazione_id),
    getDelayAnalysis(organizzazione_id)
  ]);

  return {
    summary: {
      totalShipments,
      lastUpdate: new Date().toISOString()
    },
    shipmentsByStatus,
    shipmentsByType,
    monthlyTrend,
    topSuppliers,
    topCarriers,
    costAnalysis,
    delayAnalysis,
    organizationId: organizzazione_id
  };
}

// ===== Query statistiche individuali =====

// Totale spedizioni
async function getTotalShipments(organizzazione_id) {
  const { count, error } = await supabase
    .from('spedizioni')
    .select('*', { count: 'exact', head: true })
    .eq('organizzazione_id', organizzazione_id);

  if (error) throw error;
  return count || 0;
}

// Spedizioni per stato
async function getShipmentsByStatus(organizzazione_id) {
  const { data, error } = await supabase
    .from('spedizioni')
    .select('stato_spedizione')
    .eq('organizzazione_id', organizzazione_id);

  if (error) throw error;

  // Raggruppa per stato
  const statusCount = {};
  data.forEach(row => {
    const status = row.stato_spedizione || 'Non definito';
    statusCount[status] = (statusCount[status] || 0) + 1;
  });

  // Converti in array per il frontend
  return Object.entries(statusCount).map(([status, count]) => ({
    status,
    count,
    percentage: Math.round((count / data.length) * 100)
  })).sort((a, b) => b.count - a.count);
}

// Spedizioni per tipo
async function getShipmentsByType(organizzazione_id) {
  const { data, error } = await supabase
    .from('spedizioni')
    .select('tipo_spedizione')
    .eq('organizzazione_id', organizzazione_id);

  if (error) throw error;

  // Raggruppa per tipo
  const typeCount = {};
  data.forEach(row => {
    const type = row.tipo_spedizione || 'Non specificato';
    typeCount[type] = (typeCount[type] || 0) + 1;
  });

  return Object.entries(typeCount).map(([type, count]) => ({
    type,
    count,
    percentage: Math.round((count / data.length) * 100)
  })).sort((a, b) => b.count - a.count);
}

// Trend mensile spedizioni (ultimi 12 mesi)
async function getMonthlyTrend(organizzazione_id) {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const { data, error } = await supabase
    .from('spedizioni')
    .select('created_at, costo_trasporto')
    .eq('organizzazione_id', organizzazione_id)
    .gte('created_at', twelveMonthsAgo.toISOString())
    .order('created_at', { ascending: true });

  if (error) throw error;

  // Raggruppa per mese
  const monthlyData = {};
  
  data.forEach(row => {
    const date = new Date(row.created_at);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {
        month: monthKey,
        count: 0,
        totalCost: 0
      };
    }
    
    monthlyData[monthKey].count++;
    monthlyData[monthKey].totalCost += row.costo_trasporto || 0;
  });

  // Converti in array ordinato
  return Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month));
}

// Top 5 fornitori
async function getTopSuppliers(organizzazione_id) {
  const { data, error } = await supabase
    .from('spedizioni')
    .select('fornitore')
    .eq('organizzazione_id', organizzazione_id)
    .not('fornitore', 'is', null);

  if (error) throw error;

  // Conta per fornitore
  const supplierCount = {};
  data.forEach(row => {
    if (row.fornitore) {
      supplierCount[row.fornitore] = (supplierCount[row.fornitore] || 0) + 1;
    }
  });

  // Top 5
  return Object.entries(supplierCount)
    .map(([supplier, count]) => ({ supplier, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

// Top 5 corrieri
async function getTopCarriers(organizzazione_id) {
  const { data, error } = await supabase
    .from('spedizioni')
    .select('compagnia')
    .eq('organizzazione_id', organizzazione_id)
    .not('compagnia', 'is', null);

  if (error) throw error;

  // Conta per corriere
  const carrierCount = {};
  data.forEach(row => {
    if (row.compagnia) {
      carrierCount[row.compagnia] = (carrierCount[row.compagnia] || 0) + 1;
    }
  });

  // Top 5
  return Object.entries(carrierCount)
    .map(([carrier, count]) => ({ carrier, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

// Analisi costi
async function getCostAnalysis(organizzazione_id) {
  const { data, error } = await supabase
    .from('spedizioni')
    .select('costo_trasporto, qty')
    .eq('organizzazione_id', organizzazione_id)
    .not('costo_trasporto', 'is', null);

  if (error) throw error;

  if (data.length === 0) {
    return {
      totalCost: 0,
      averageCost: 0,
      minCost: 0,
      maxCost: 0,
      averageCostPerUnit: 0
    };
  }

  const costs = data.map(row => row.costo_trasporto || 0);
  const totalCost = costs.reduce((sum, cost) => sum + cost, 0);
  
  // Calcola costo per unità dove qty > 0
  let totalCostPerUnit = 0;
  let countWithQty = 0;
  
  data.forEach(row => {
    if (row.qty && row.qty > 0 && row.costo_trasporto) {
      totalCostPerUnit += row.costo_trasporto / row.qty;
      countWithQty++;
    }
  });

  return {
    totalCost: Math.round(totalCost * 100) / 100,
    averageCost: Math.round((totalCost / costs.length) * 100) / 100,
    minCost: Math.min(...costs),
    maxCost: Math.max(...costs),
    averageCostPerUnit: countWithQty > 0 
      ? Math.round((totalCostPerUnit / countWithQty) * 100) / 100 
      : 0
  };
}

// Analisi ritardi
async function getDelayAnalysis(organizzazione_id) {
  const { data, error } = await supabase
    .from('spedizioni')
    .select('data_partenza, data_arrivo_effettiva, stato_spedizione')
    .eq('organizzazione_id', organizzazione_id)
    .not('data_partenza', 'is', null)
    .not('data_arrivo_effettiva', 'is', null);

  if (error) throw error;

  let onTime = 0;
  let delayed = 0;
  let totalDelay = 0;
  const delays = [];

  data.forEach(row => {
    const departure = new Date(row.data_partenza);
    const arrival = new Date(row.data_arrivo_effettiva);
    const transitDays = Math.floor((arrival - departure) / (1000 * 60 * 60 * 24));
    
    // Considera ritardo se > 30 giorni di transito (personalizzabile)
    if (transitDays > 30) {
      delayed++;
      const delayDays = transitDays - 30;
      totalDelay += delayDays;
      delays.push(delayDays);
    } else {
      onTime++;
    }
  });

  return {
    totalShipments: data.length,
    onTime,
    delayed,
    onTimePercentage: data.length > 0 
      ? Math.round((onTime / data.length) * 100) 
      : 100,
    averageDelay: delays.length > 0 
      ? Math.round((totalDelay / delays.length) * 10) / 10 
      : 0,
    maxDelay: delays.length > 0 ? Math.max(...delays) : 0
  };
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