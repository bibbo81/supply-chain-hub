import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

exports.handler = async (event, context) => {
  // Headers CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Inizializza client Supabase
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Estrai parametri dalla query string
    const { year = 2024, month = 1 } = event.queryStringParameters || {};
    const targetYear = parseInt(year);
    const targetMonth = parseInt(month);

    // Nome del mese per il frontend
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[targetMonth - 1];

    // Query per dati analytics correnti
    const { data: currentData, error: currentError } = await supabase
      .from('mv_analytics_monthly')
      .select('*')
      .eq('created_year', targetYear)
      .eq('created_month', targetMonth)
      .single();

    if (currentError && currentError.code !== 'PGRST116') {
      throw currentError;
    }

    // Query per dati del mese precedente (per calcolare growth)
    let prevYear = targetYear;
    let prevMonth = targetMonth - 1;
    if (prevMonth < 1) {
      prevMonth = 12;
      prevYear = targetYear - 1;
    }

    const { data: prevData } = await supabase
      .from('mv_analytics_monthly')
      .select('*')
      .eq('created_year', prevYear)
      .eq('created_month', prevMonth)
      .single();

    // Query per distribuzione stati
    const { data: statusData, error: statusError } = await supabase
      .from('shipments')
      .select('status')
      .gte('shipment_date', `${targetYear}-${targetMonth.toString().padStart(2, '0')}-01`)
      .lt('shipment_date', `${targetYear}-${(targetMonth + 1).toString().padStart(2, '0')}-01`);

    if (statusError) {
      console.error('Status query error:', statusError);
    }

    // Query per carrier performance
    const { data: carrierData, error: carrierError } = await supabase
      .from('shipments')
      .select('carrier, cost, delivery_date, shipment_date, status')
      .gte('shipment_date', `${targetYear}-${targetMonth.toString().padStart(2, '0')}-01`)
      .lt('shipment_date', `${targetYear}-${(targetMonth + 1).toString().padStart(2, '0')}-01`);

    if (carrierError) {
      console.error('Carrier query error:', carrierError);
    }

    // Query per dati annuali (per chart)
    const { data: yearlyData, error: yearlyError } = await supabase
      .from('mv_analytics_monthly')
      .select('*')
      .eq('created_year', targetYear)
      .order('created_month', { ascending: true });

    if (yearlyError) {
      console.error('Yearly query error:', yearlyError);
    }

    // Dati di default se non trovati
    const current = currentData || {
      total_shipments: 0,
      total_revenue: 0,
      avg_cost: 0,
      delivery_rate: 0,
      data_quality_score: 100
    };

    const previous = prevData || {
      total_shipments: 0,
      total_revenue: 0,
      avg_cost: 0,
      delivery_rate: 0
    };

    // Calcola growth month-over-month
    const calculateGrowth = (current, previous) => {
      if (previous === 0) return { value: 0, percentage: 0 };
      const growth = current - previous;
      const percentage = (growth / previous) * 100;
      return {
        value: growth,
        percentage: Math.round(percentage * 100) / 100
      };
    };

    // Processa distribuzione stati
    const statusDistribution = {
      consegnato: 0,
      in_transito: 0,
      arrivato: 0,
      other: 0
    };

    if (statusData) {
      statusData.forEach(item => {
        const status = item.status?.toLowerCase();
        if (status === 'consegnato') {
          statusDistribution.consegnato++;
        } else if (status === 'in transito') {
          statusDistribution.in_transito++;
        } else if (status === 'arrivato') {
          statusDistribution.arrivato++;
        } else {
          statusDistribution.other++;
        }
      });
    }

    // Processa carrier performance
    const carrierPerformance = [];
    if (carrierData) {
      const carrierStats = {};
      
      carrierData.forEach(shipment => {
        const carrier = shipment.carrier;
        if (!carrierStats[carrier]) {
          carrierStats[carrier] = {
            shipments: 0,
            totalCost: 0,
            delivered: 0,
            onTime: 0
          };
        }
        
        carrierStats[carrier].shipments++;
        carrierStats[carrier].totalCost += shipment.cost || 0;
        
        if (shipment.status === 'CONSEGNATO') {
          carrierStats[carrier].delivered++;
        }
        
        // Calcola on-time delivery (se consegnato entro 7 giorni)
        if (shipment.delivery_date && shipment.shipment_date) {
          const shipDate = new Date(shipment.shipment_date);
          const deliveryDate = new Date(shipment.delivery_date);
          const daysDiff = (deliveryDate - shipDate) / (1000 * 60 * 60 * 24);
          
          if (daysDiff <= 7) {
            carrierStats[carrier].onTime++;
          }
        }
      });

      // Converti in array per il frontend
      Object.entries(carrierStats).forEach(([carrier, stats]) => {
        carrierPerformance.push({
          carrier,
          shipments: stats.shipments,
          avgCost: stats.shipments > 0 ? Math.round(stats.totalCost / stats.shipments) : 0,
          deliveryRate: stats.shipments > 0 ? Math.round((stats.delivered / stats.shipments) * 100) : 0,
          onTimeRate: stats.shipments > 0 ? Math.round((stats.onTime / stats.shipments) * 100) : 0
        });
      });
    }

    // Crea array per charts (12 mesi)
    const chartLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const currentYearData = new Array(12).fill(0);
    const previousYearData = new Array(12).fill(0);

    // Popola dati correnti
    if (yearlyData) {
      yearlyData.forEach(item => {
        const monthIndex = item.created_month - 1;
        if (monthIndex >= 0 && monthIndex < 12) {
          currentYearData[monthIndex] = item.total_shipments || 0;
        }
      });
    }

    // Query per anno precedente
    const { data: prevYearData } = await supabase
      .from('mv_analytics_monthly')
      .select('*')
      .eq('created_year', targetYear - 1)
      .order('created_month', { ascending: true });

    if (prevYearData) {
      prevYearData.forEach(item => {
        const monthIndex = item.created_month - 1;
        if (monthIndex >= 0 && monthIndex < 12) {
          previousYearData[monthIndex] = item.total_shipments || 0;
        }
      });
    }

    // Genera insights dinamici
    const insights = {
      summary: `Performance analytics for ${monthName} ${targetYear}`,
      keyFindings: [
        `${current.total_shipments} total shipments processed`,
        `€${current.total_revenue.toLocaleString()} in total revenue`,
        `${current.delivery_rate}% delivery success rate`
      ],
      recommendations: [
        current.delivery_rate < 50 ? 'Focus on improving delivery performance' : 'Maintain current service levels',
        current.total_shipments > 0 ? 'Continue monitoring carrier performance' : 'Increase shipment volume'
      ]
    };

    // Performance metrics
    const performance = {
      dataQuality: {
        score: current.data_quality_score || 100,
        status: current.data_quality_score >= 90 ? 'excellent' : 'good'
      },
      systemHealth: {
        status: 'operational',
        uptime: 99.9,
        lastUpdate: new Date().toISOString()
      }
    };

    // Alerts basati sui dati
    const alerts = [];
    if (current.delivery_rate < 50) {
      alerts.push({
        type: 'warning',
        message: 'Delivery rate below 50% - review carrier performance',
        priority: 'high'
      });
    }
    if (current.total_shipments === 0) {
      alerts.push({
        type: 'info',
        message: 'No shipments recorded for this period',
        priority: 'medium'
      });
    }

    // Costruisci la risposta nel formato atteso dal frontend
    const response = {
      success: true,
      period: {
        year: targetYear,
        month: targetMonth,
        monthName: monthName
      },
      current: {
        month: {
          shipments: current.total_shipments,
          revenue: current.total_revenue,
          avgCost: current.avg_cost,
          deliveryRate: current.delivery_rate
        }
      },
      growth: {
        mom: {
          shipments: calculateGrowth(current.total_shipments, previous.total_shipments),
          revenue: calculateGrowth(current.total_revenue, previous.total_revenue),
          avgCost: calculateGrowth(current.avg_cost, previous.avg_cost)
        }
      },
      charts: {
        labels: chartLabels,
        shipments: {
          current: currentYearData,
          previous: previousYearData
        }
      },
      status: {
        distribution: statusDistribution
      },
      insights: insights,
      performance: performance,
      alerts: alerts,
      // Dati aggiuntivi per tabelle
      carrierPerformance: carrierPerformance,
      recentShipments: carrierData ? carrierData.slice(0, 10) : []
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Dashboard Stats Error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};
