// MAPPING COMPLETO BASATO SUL TUO GOOGLE SHEETS
const COMPLETE_STATUS_MAPPING = {
  // STATI MARITTIMI
  'Sailing': 'in_transit',
  'Arrived': 'in_transit',  // Arrivata al porto ma non ancora scaricata
  'Delivered': 'delivered',
  'Discharged': 'delivered',  // Scaricato = consegnato al terminal
  
  // STATI FEDEX
  'On FedEx vehicle for delivery': 'in_transit',  // In consegna oggi
  'At local FedEx facility': 'in_transit',
  'Departed FedEx hub': 'in_transit',
  'On the way': 'in_transit',
  'Arrived at FedEx hub': 'in_transit',
  'International shipment release - Import': 'in_transit',  // Sdoganata
  'At destination sort facility': 'in_transit',
  'Left FedEx origin facility': 'in_transit',
  'Picked up': 'in_transit',
  'Shipment information sent to FedEx': 'registered',  // Spedizione creata
  
  // STATI GLS
  'Consegnata.': 'delivered',
  'Consegna prevista nel corso della giornata odierna.': 'in_transit',
  'Arrivata nella Sede GLS locale.': 'in_transit',
  'In transito.': 'in_transit',
  'Partita dalla sede mittente. In transito.': 'in_transit',
  "La spedizione e' stata creata dal mittente, attendiamo che ci venga affidata per l'invio a destinazione.": 'registered',
  
  // STATI GENERICI ITALIANI
  'LA spedizione è stata consegnata': 'delivered',
  'La spedizione è stata consegnata': 'delivered',
  'La spedizione è in consegna': 'in_transit',
  'La spedizione è in transito': 'in_transit',
  
  // STATI SHIPSGO ESISTENTI
  'Gate In': 'in_transit',
  'Gate Out': 'in_transit',
  'Loaded': 'in_transit',
  'Loaded on Vessel': 'in_transit',
  'Vessel Departed': 'in_transit',
  'Vessel Arrived': 'in_transit',
  'Empty': 'delivered',
  'Empty Returned': 'delivered',
  'Empty Container Returned': 'delivered',
  'Registered': 'registered',
  'Pending': 'registered',
  'Transhipment': 'in_transit',
  'Rail Departed': 'in_transit',
  'Customs Hold': 'delayed',
  'Rolled': 'delayed',
  'Cancelled': 'cancelled',
  
  // STATI DHL
  'Shipment information received': 'registered',
  'Shipment picked up': 'in_transit',
  'Processed': 'in_transit',
  'Departed Facility': 'in_transit',
  'Arrived Facility': 'in_transit',
  'With delivery courier': 'in_transit',
  'Out for Delivery': 'in_transit',
  'Delivered': 'delivered',
  'Signed': 'delivered',
  
  // STATI UPS
  'Order Processed': 'registered',
  'Out For Delivery': 'in_transit',
  'Exception': 'exception',
  'Returned to Sender': 'exception',
  'Delivery Attempted': 'delayed',
  'Customer not Available': 'delayed',
  'Incorrect Address': 'exception'
};

// MAPPING PER DISPLAY UI (ITALIANO)
const STATUS_DISPLAY_MAPPING = {
  'registered': 'Spedizione Creata',
  'in_transit': 'In Transito',
  'delivered': 'Consegnato',
  'delayed': 'In Ritardo',
  'exception': 'Eccezione',
  'cancelled': 'Cancellato'
};

// SOTTOSTATI PIÙ SPECIFICI PER UI
const DETAILED_STATUS_MAPPING = {
  // In Transit con più dettaglio
  'Sailing': { status: 'in_transit', detail: 'In navigazione' },
  'Arrived': { status: 'in_transit', detail: 'Arrivata al porto' },
  'International shipment release - Import': { status: 'in_transit', detail: 'Sdoganata' },
  'On FedEx vehicle for delivery': { status: 'in_transit', detail: 'In consegna oggi' },
  'Consegna prevista nel corso della giornata odierna.': { status: 'in_transit', detail: 'In consegna oggi' },
  
  // Delivered con più dettaglio
  'Discharged': { status: 'delivered', detail: 'Scaricato dal vessel' },
  'Empty': { status: 'delivered', detail: 'Container vuoto restituito' }
};

// Funzione intelligente per determinare status
function determineTrackingStatus(apiStatus, trackingType = null, additionalData = {}) {
  // 1. Cerca mapping esatto (case insensitive)
  const statusUpper = apiStatus.toUpperCase();
  for (const [key, value] of Object.entries(COMPLETE_STATUS_MAPPING)) {
    if (key.toUpperCase() === statusUpper) {
      return value;
    }
  }
  
  // 2. Cerca match parziale per stati lunghi
  const statusLower = apiStatus.toLowerCase();
  
  // Keywords per delivered
  if (statusLower.includes('consegnat') || 
      statusLower.includes('delivered') ||
      statusLower.includes('empty') ||
      statusLower.includes('discharged') ||
      statusLower.includes('scaricato')) {
    return 'delivered';
  }
  
  // Keywords per in transit
  if (statusLower.includes('transit') || 
      statusLower.includes('sailing') ||
      statusLower.includes('departed') ||
      statusLower.includes('loaded') ||
      statusLower.includes('arrived') ||
      statusLower.includes('consegna') ||
      statusLower.includes('on the way') ||
      statusLower.includes('sdoganat')) {
    return 'in_transit';
  }
  
  // Keywords per registered
  if (statusLower.includes('creata') || 
      statusLower.includes('created') ||
      statusLower.includes('information sent') ||
      statusLower.includes('registered') ||
      statusLower.includes('booked')) {
    return 'registered';
  }
  
  // Keywords per delayed
  if (statusLower.includes('delay') || 
      statusLower.includes('ritardo') ||
      statusLower.includes('hold') ||
      statusLower.includes('customs')) {
    return 'delayed';
  }
  
  // Keywords per exception
  if (statusLower.includes('exception') || 
      statusLower.includes('error') ||
      statusLower.includes('problem') ||
      statusLower.includes('returned')) {
    return 'exception';
  }
  
  // 3. Default basato su tipo
  if (trackingType) {
    switch (trackingType) {
      case 'container':
      case 'bl':
        return 'in_transit';  // Container di default in transito
      case 'awb':
      case 'parcel':
        return 'registered';  // Parcel di default registrato
    }
  }
  
  // 4. Default finale
  return 'in_transit';
}

module.exports = {
  COMPLETE_STATUS_MAPPING,
  STATUS_DISPLAY_MAPPING,
  DETAILED_STATUS_MAPPING,
  determineTrackingStatus
};