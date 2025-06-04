// netlify/functions/get-costs.js
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

exports.handler = async (event, context) => {
    // Enable CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    // Handle OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers,
            body: ''
        };
    }

    // Only allow GET
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        // Get auth token
        const token = event.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Missing authorization token' })
            };
        }

        // Verify token and get user
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Invalid token' })
            };
        }

        // Get organization_id from user metadata
        const organizationId = user.user_metadata?.organization_id;
        if (!organizationId) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'No organization associated with user' })
            };
        }

        // Get query parameters
        const { period = '30' } = event.queryStringParameters || {};
        
        // Calculate date range
        const endDate = new Date();
        const startDate = new Date();
        
        if (period === 'custom') {
            // For custom period, expect start and end dates in query params
            const { start, end } = event.queryStringParameters || {};
            if (start) startDate.setTime(Date.parse(start));
            if (end) endDate.setTime(Date.parse(end));
        } else {
            const days = parseInt(period);
            startDate.setDate(startDate.getDate() - days);
        }

        // Get shipments data with costs
        const { data: shipments, error: shipmentsError } = await supabase
            .from('shipments')
            .select(`
                n_oda,
                cod_art,
                data_partenza,
                fornitore,
                spedizioniere,
                tipo_spedizione,
                quantita,
                costo_trasporto,
                costo_unitario_trasporto,
                stato_spedizione
            `)
            .eq('organizzazione_id', organizationId)
            .gte('data_partenza', startDate.toISOString())
            .lte('data_partenza', endDate.toISOString())
            .not('costo_trasporto', 'is', null)
            .order('data_partenza', { ascending: false });

        if (shipmentsError) {
            console.error('Error fetching shipments:', shipmentsError);
            throw shipmentsError;
        }

        // Calculate KPIs
        const totalCost = shipments.reduce((sum, s) => sum + (s.costo_trasporto || 0), 0);
        const avgShipmentCost = shipments.length > 0 ? totalCost / shipments.length : 0;

        // Get previous period data for comparison
        const prevStartDate = new Date(startDate);
        const prevEndDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - (endDate - startDate) / (1000 * 60 * 60 * 24));
        
        const { data: prevShipments } = await supabase
            .from('shipments')
            .select('costo_trasporto')
            .eq('organizzazione_id', organizationId)
            .gte('data_partenza', prevStartDate.toISOString())
            .lt('data_partenza', prevEndDate.toISOString())
            .not('costo_trasporto', 'is', null);

        const prevTotalCost = prevShipments?.reduce((sum, s) => sum + (s.costo_trasporto || 0), 0) || 0;
        const prevAvgCost = prevShipments?.length > 0 ? prevTotalCost / prevShipments.length : 0;

        // Calculate changes
        const totalCostChange = prevTotalCost > 0 ? ((totalCost - prevTotalCost) / prevTotalCost) * 100 : 0;
        const avgCostChange = prevAvgCost > 0 ? ((avgShipmentCost - prevAvgCost) / prevAvgCost) * 100 : 0;

        // Get budget info (could be from organization settings)
        const monthlyBudget = 150000; // Default, should come from organization settings
        const daysInMonth = 30;
        const daysElapsed = Math.min((endDate - new Date(endDate.getFullYear(), endDate.getMonth(), 1)) / (1000 * 60 * 60 * 24), daysInMonth);
        const budgetProrated = (monthlyBudget / daysInMonth) * daysElapsed;
        const budgetUsed = Math.round((totalCost / budgetProrated) * 100);
        const budgetRemaining = Math.max(monthlyBudget - totalCost, 0);
        
        // Calculate projected month-end cost
        const dailyAvg = totalCost / daysElapsed;
        const projectedMonthTotal = dailyAvg * daysInMonth;

        // Calculate potential savings (example: 8% optimization)
        const potentialSavings = totalCost * 0.08;

        // Prepare response
        const response = {
            shipments: shipments || [],
            kpis: {
                totalCost,
                totalCostChange,
                avgShipmentCost,
                avgCostChange,
                budgetUsed,
                budgetRemaining,
                potentialSavings,
                shipmentCount: shipments.length
            },
            budget: {
                monthly: monthlyBudget,
                spent: totalCost,
                projected: projectedMonthTotal,
                percentage: budgetUsed
            },
            period: {
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                days: Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
            }
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(response)
        };

    } catch (error) {
        console.error('Error in get-costs function:', error);
        
        // Return mock data for demo purposes
        const mockData = generateMockData();
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(mockData)
        };
    }
};

// Generate mock data for demo
function generateMockData() {
    const carriers = ['DHL', 'FedEx', 'UPS', 'TNT', 'GLS', 'SCHENKER', 'WORLD CARGO'];
    const types = ['MARE', 'AEREO', 'STRADA'];
    const suppliers = [
        'Supplier Milano Srl', 
        'Fornitore Roma SpA', 
        'Produttore Napoli', 
        'Import/Export Genova',
        'Distributore Torino',
        'Grossista Venezia',
        'Manufacturer Bologna',
        'Wholesale Firenze',
        'Trading Palermo',
        'Logistics Bari'
    ];
    
    const shipments = [];
    const today = new Date();
    
    // Generate 150 mock shipments for last 30 days
    for (let i = 0; i < 150; i++) {
        const daysAgo = Math.floor(Math.random() * 30);
        const date = new Date(today);
        date.setDate(date.getDate() - daysAgo);
        
        const quantity = Math.floor(Math.random() * 1000) + 100;
        const type = types[Math.floor(Math.random() * types.length)];
        const baseRate = type === 'AEREO' ? 2.5 : type === 'MARE' ? 0.8 : 1.2;
        const baseCost = (Math.random() * 2000 + 500) * baseRate;
        
        shipments.push({
            n_oda: `ODA-2024-${String(10000 + i).padStart(5, '0')}`,
            cod_art: `ART-${String(Math.floor(Math.random() * 999) + 1).padStart(3, '0')}`,
            data_partenza: date.toISOString(),
            fornitore: suppliers[Math.floor(Math.random() * suppliers.length)],
            spedizioniere: carriers[Math.floor(Math.random() * carriers.length)],
            tipo_spedizione: type,
            quantita: quantity,
            costo_trasporto: Math.round(baseCost * 100) / 100,
            costo_unitario_trasporto: Math.round((baseCost / quantity) * 100) / 100,
            stato_spedizione: 'Consegnato'
        });
    }
    
    // Sort by date
    shipments.sort((a, b) => new Date(b.data_partenza) - new Date(a.data_partenza));
    
    // Calculate KPIs
    const totalCost = shipments.reduce((sum, s) => sum + s.costo_trasporto, 0);
    const avgShipmentCost = totalCost / shipments.length;
    const monthlyBudget = 150000;
    const budgetUsed = Math.round((totalCost / monthlyBudget) * 100);
    
    return {
        shipments,
        kpis: {
            totalCost,
            totalCostChange: -8.5,
            avgShipmentCost,
            avgCostChange: 3.2,
            budgetUsed,
            budgetRemaining: monthlyBudget - totalCost,
            potentialSavings: totalCost * 0.08,
            shipmentCount: shipments.length
        },
        budget: {
            monthly: monthlyBudget,
            spent: totalCost,
            projected: totalCost * 1.1,
            percentage: budgetUsed
        },
        period: {
            start: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            end: today.toISOString(),
            days: 30
        }
    };
}