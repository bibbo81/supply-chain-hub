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

    // Parametri dalla query string
    const { period = '30' } = event.queryStringParameters || {};
    const daysBack = parseInt(period);

    // Calcola date per il periodo
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    
    const previousStartDate = new Date();
    previousStartDate.setDate(previousStartDate.getDate() - (daysBack * 2));
    
    // Query tutte le spedizioni per il periodo esteso (per confronti)
    const { data: allShipments, error: queryError } = await supabase
      .from('shipments')
      .select('*')
      .eq('organizzazione_id', organizationId)
      .gte('created_at', previousStartDate.toISOString())
      .lt('created_at', endDate.toISOString());

    if (queryError) {
      console.error('Query error:', queryError);
      throw queryError;
    }

    // Dividi spedizioni per periodo
    const currentShipments = allShipments.filter(s => 
      new Date(s.created_at) >= startDate
    );
    const previousShipments = allShipments.filter(s => 
      new Date(s.created_at) < startDate
    );

    // Calcola metriche complete
    const currentStats = calculateCompleteStats(currentShipments);
    const previousStats = calculateCompleteStats(previousShipments);

    // Calcola variazioni
    const response = {
      // KPI Principali (compatibili con frontend esistente)
      totalRevenue: currentStats.totalTransportCost,
      revenueGrowth: calculateGrowth(currentStats.totalTransportCost, previousStats.totalTransportCost),
      totalShipments: currentStats.count,
      shipmentsGrowth: calculateGrowth(currentStats.count, previousStats.count),
      avgDeliveryTime: currentStats.avgDeliveryTime,
      deliveryTimeChange: calculateGrowth(currentStats.avgDeliveryTime, previousStats.avgDeliveryTime),
      onTimeDelivery: currentStats.onTimePercentage,
      onTimeChange: calculateGrowth(currentStats.onTimePercentage, previousStats.onTimePercentage),
      
      // Metriche Costi Dettagliate
      costs: {
        totalTransportCost: currentStats.totalTransportCost,
        totalCustomsDuty: currentStats.totalCustomsDuty,
        totalCost: currentStats.totalCost,
        avgCostPerShipment: currentStats.avgCostPerShipment,
        avgCostPerUnit: currentStats.avgCostPerUnit,
        costGrowth: calculateGrowth(currentStats.totalCost, previousStats.totalCost)
      },
      
      // Metriche Volume
      volume: {
        totalQuantity: currentStats.totalQuantity,
        uniqueSuppliers: currentStats.uniqueSuppliers,
        uniqueArticles: currentStats.uniqueArticles,
        quantityGrowth: calculateGrowth(currentStats.totalQuantity, previousStats.totalQuantity)
      },
      
      // Top 5 Fornitori
      topSuppliers: currentStats.topSuppliers,
      
      // Top 5 Spedizionieri
      topCarriers: currentStats.topCarriers,
      
      // Top 5 Articoli
      topArticles: currentStats.topArticles,
      
      // Breakdown per stato
      statusBreakdown: currentStats.statusBreakdown,
      
      // Alert
      alerts: {
        highCostShipments: currentStats.highCostShipments,
        delayedShipments: currentStats.delayedShipments,
        missingTracking: currentStats.missingTracking
      },
      
      // Trend giornaliero
      dailyTrend: currentStats.dailyTrend,
      
      // Metadata
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        days: daysBack
      }
    };

    console.log('Enhanced stats response ready');

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

// Funzione per calcolare statistiche complete
function calculateCompleteStats(shipments) {
  if (!shipments || shipments.length === 0) {
    return {
      count: 0,
      totalTransportCost: 0,
      totalCustomsDuty: 0,
      totalCost: 0,
      totalQuantity: 0,
      avgCostPerShipment: 0,
      avgCostPerUnit: 0,
      avgDeliveryTime: 0,
      onTimePercentage: 0,
      uniqueSuppliers: 0,
      uniqueArticles: 0,
      topSuppliers: [],
      topCarriers: [],
      topArticles: [],
      statusBreakdown: {},
      highCostShipments: 0,
      delayedShipments: 0,
      missingTracking: 0,
      dailyTrend: []
    };
  }

  // Calcoli base
  const totalTransportCost = shipments.reduce((sum, s) => sum + (parseFloat(s.costo_trasporto) || 0), 0);
  const totalQuantity = shipments.reduce((sum, s) => sum + (parseFloat(s.qty) || 0), 0);
  
  // Calcola dazi totali
  let totalCustomsDuty = 0;
  shipments.forEach(s => {
    const value = parseFloat(s.valore) || 0;
    const dutyPercentage = parseFloat(s.percentuale_dazio) || 0;
    totalCustomsDuty += (value * dutyPercentage / 100);
  });
  
  const totalCost = totalTransportCost + totalCustomsDuty;
  const avgCostPerShipment = shipments.length > 0 ? totalCost / shipments.length : 0;
  const avgCostPerUnit = totalQuantity > 0 ? totalCost / totalQuantity : 0;

  // Calcola tempo medio consegna e puntualità
  let totalDeliveryDays = 0;
  let deliveredCount = 0;
  let onTimeCount = 0;
  let delayedCount = 0;

  shipments.forEach(shipment => {
    // Conta ritardi
    if ((shipment.ritardo_giorni || 0) > 0) {
      delayedCount++;
    }

    // Per spedizioni consegnate
    if (shipment.stato_spedizione === 'CONSEGNATO' && shipment.data_arrivo_effettiva) {
      if (shipment.transit_time_giorni) {
        totalDeliveryDays += shipment.transit_time_giorni;
        deliveredCount++;
        
        // Considera puntuale se ritardo <= 0
        if ((shipment.ritardo_giorni || 0) <= 0) {
          onTimeCount++;
        }
      }
    }
  });

  const avgDeliveryTime = deliveredCount > 0 ? totalDeliveryDays / deliveredCount : 0;
  const onTimePercentage = deliveredCount > 0 ? (onTimeCount / deliveredCount) * 100 : 0;

  // Calcola unique counts
  const uniqueSuppliers = new Set(shipments.map(s => s.fornitore).filter(Boolean)).size;
  const uniqueArticles = new Set(shipments.map(s => s.cod_art).filter(Boolean)).size;

  // Top 5 Fornitori per volume
  const supplierStats = {};
  shipments.forEach(s => {
    if (s.fornitore) {
      if (!supplierStats[s.fornitore]) {
        supplierStats[s.fornitore] = {
          name: s.fornitore,
          count: 0,
          totalCost: 0,
          totalQuantity: 0
        };
      }
      supplierStats[s.fornitore].count++;
      supplierStats[s.fornitore].totalCost += parseFloat(s.costo_trasporto) || 0;
      supplierStats[s.fornitore].totalQuantity += parseFloat(s.qty) || 0;
    }
  });
  
  const topSuppliers = Object.values(supplierStats)
    .sort((a, b) => b.totalQuantity - a.totalQuantity)
    .slice(0, 5)
    .map(s => ({
      name: s.name,
      quantity: Math.round(s.totalQuantity),
      cost: Math.round(s.totalCost * 100) / 100,
      shipments: s.count
    }));

  // Top 5 Spedizionieri per costo
  const carrierStats = {};
  shipments.forEach(s => {
    if (s.spedizioniere) {
      if (!carrierStats[s.spedizioniere]) {
        carrierStats[s.spedizioniere] = {
          name: s.spedizioniere,
          count: 0,
          totalCost: 0
        };
      }
      carrierStats[s.spedizioniere].count++;
      carrierStats[s.spedizioniere].totalCost += parseFloat(s.costo_trasporto) || 0;
    }
  });
  
  const topCarriers = Object.values(carrierStats)
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, 5)
    .map(c => ({
      name: c.name,
      cost: Math.round(c.totalCost * 100) / 100,
      shipments: c.count,
      avgCost: Math.round(c.totalCost / c.count * 100) / 100
    }));

  // Top 5 Articoli per quantità
  const articleStats = {};
  shipments.forEach(s => {
    if (s.cod_art) {
      if (!articleStats[s.cod_art]) {
        articleStats[s.cod_art] = {
          code: s.cod_art,
          description: s.descrizione || s.cod_art,
          quantity: 0,
          shipments: 0
        };
      }
      articleStats[s.cod_art].quantity += parseFloat(s.qty) || 0;
      articleStats[s.cod_art].shipments++;
    }
  });
  
  const topArticles = Object.values(articleStats)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  // Status breakdown
  const statusBreakdown = {};
  shipments.forEach(s => {
    const status = s.stato_spedizione || 'UNKNOWN';
    statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
  });

  // Alert counts
  const highCostShipments = shipments.filter(s => 
    (parseFloat(s.costo_trasporto) || 0) > 1000
  ).length;
  
  const missingTracking = shipments.filter(s => !s.rif_spedizione).length;

  // Daily trend
  const dailyData = {};
  shipments.forEach(s => {
    const date = s.created_at.split('T')[0];
    if (!dailyData[date]) {
      dailyData[date] = {
        date,
        count: 0,
        cost: 0
      };
    }
    dailyData[date].count++;
    dailyData[date].cost += parseFloat(s.costo_trasporto) || 0;
  });
  
  const dailyTrend = Object.values(dailyData)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({
      ...d,
      cost: Math.round(d.cost * 100) / 100
    }));

  return {
    count: shipments.length,
    totalTransportCost: Math.round(totalTransportCost * 100) / 100,
    totalCustomsDuty: Math.round(totalCustomsDuty * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    totalQuantity: Math.round(totalQuantity),
    avgCostPerShipment: Math.round(avgCostPerShipment * 100) / 100,
    avgCostPerUnit: Math.round(avgCostPerUnit * 100) / 100,
    avgDeliveryTime: Math.round(avgDeliveryTime * 10) / 10,
    onTimePercentage: Math.round(onTimePercentage * 10) / 10,
    uniqueSuppliers,
    uniqueArticles,
    topSuppliers,
    topCarriers,
    topArticles,
    statusBreakdown,
    highCostShipments,
    delayedShipments: delayedCount,
    missingTracking,
    dailyTrend
  };
}

// Calcola la variazione percentuale
function calculateGrowth(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  const growth = ((current - previous) / previous) * 100;
  return Math.round(growth * 10) / 10;
}