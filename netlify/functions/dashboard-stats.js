// netlify/functions/dashboard-stats.js
const { createClient } = require('@supabase/supabase-js');

// Headers CORS
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  console.log('Dashboard Stats Function called:', event.httpMethod);
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Usa le variabili d'ambiente corrette (senza VITE_ per le functions)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing environment variables');
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Estrai token
    const authHeader = event.headers.authorization || event.headers.Authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Missing authorization token' })
      };
    }

    const token = authHeader.replace('Bearer ', '');

    // Verifica utente
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Auth error:', authError);
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid token' })
      };
    }

    // Ottieni organizzazione_id dal profilo utente
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organizzazione_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.organizzazione_id) {
      console.error('Profile error:', profileError);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'User profile not found' })
      };
    }

    const organizationId = profile.organizzazione_id;
    console.log('Organization ID:', organizationId);

    // Calcola date per il periodo
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30); // Ultimi 30 giorni
    
    const previousStartDate = new Date();
    previousStartDate.setDate(previousStartDate.getDate() - 60); // 30-60 giorni fa
    
    // Query statistiche principali
    const [currentStats, previousStats] = await Promise.all([
      // Stats ultimi 30 giorni
      getStatsForPeriod(supabase, organizationId, startDate, endDate),
      // Stats 30 giorni precedenti per confronto
      getStatsForPeriod(supabase, organizationId, previousStartDate, startDate)
    ]);

    // Calcola le variazioni percentuali
    const revenueGrowth = calculateGrowth(currentStats.revenue, previousStats.revenue);
    const shipmentsGrowth = calculateGrowth(currentStats.count, previousStats.count);
    const deliveryTimeChange = calculateGrowth(currentStats.avgDeliveryTime, previousStats.avgDeliveryTime);
    const onTimeChange = calculateGrowth(currentStats.onTimePercentage, previousStats.onTimePercentage);

    // Prepara la risposta nel formato atteso dal frontend
    const response = {
      totalRevenue: currentStats.revenue,
      revenueGrowth,
      totalShipments: currentStats.count,
      shipmentsGrowth,
      avgDeliveryTime: currentStats.avgDeliveryTime,
      deliveryTimeChange,
      onTimeDelivery: currentStats.onTimePercentage,
      onTimeChange
    };

    console.log('Stats response:', response);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Dashboard stats error:', error);
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

// Funzione helper per ottenere stats per un periodo
async function getStatsForPeriod(supabase, organizationId, startDate, endDate) {
  // Query spedizioni nel periodo - usa tabella 'shipments' e campo 'organizzazione_id'
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('*')
    .eq('organizzazione_id', organizationId)
    .gte('created_at', startDate.toISOString())
    .lt('created_at', endDate.toISOString());

  if (error) {
    console.error('Query error:', error);
    throw error;
  }

  // Se non ci sono spedizioni, ritorna valori di default
  if (!shipments || shipments.length === 0) {
    return {
      count: 0,
      revenue: 0,
      avgDeliveryTime: 0,
      onTimePercentage: 0
    };
  }

  // Calcola revenue totale - usa campo 'costo_trasporto'
  const revenue = shipments.reduce((sum, s) => sum + (parseFloat(s.costo_trasporto) || 0), 0);

  // Calcola tempo medio di consegna e puntualità
  let totalDeliveryDays = 0;
  let deliveredCount = 0;
  let onTimeCount = 0;

  shipments.forEach(shipment => {
    // Usa i campi italiani corretti
    if (shipment.stato_spedizione === 'CONSEGNATO' && shipment.data_arrivo_effettiva) {
      const createdDate = new Date(shipment.created_at);
      const deliveryDate = new Date(shipment.data_arrivo_effettiva);
      const daysDiff = Math.ceil((deliveryDate - createdDate) / (1000 * 60 * 60 * 24));
      
      totalDeliveryDays += daysDiff;
      deliveredCount++;

      // Per la puntualità, confronta con data_partenza + transit time standard (es. 30 giorni)
      if (shipment.data_partenza) {
        const departureDate = new Date(shipment.data_partenza);
        const expectedDate = new Date(departureDate);
        expectedDate.setDate(expectedDate.getDate() + 30); // Assumiamo 30 giorni come standard
        
        if (deliveryDate <= expectedDate) {
          onTimeCount++;
        }
      }
    }
  });

  const avgDeliveryTime = deliveredCount > 0 ? totalDeliveryDays / deliveredCount : 0;
  const onTimePercentage = deliveredCount > 0 ? (onTimeCount / deliveredCount) * 100 : 0;

  return {
    count: shipments.length,
    revenue: Math.round(revenue * 100) / 100,
    avgDeliveryTime: Math.round(avgDeliveryTime * 10) / 10,
    onTimePercentage: Math.round(onTimePercentage * 10) / 10
  };
}

// Calcola la variazione percentuale
function calculateGrowth(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  const growth = ((current - previous) / previous) * 100;
  return Math.round(growth * 10) / 10;
}