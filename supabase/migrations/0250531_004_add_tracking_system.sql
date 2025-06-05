-- Migration: Add Tracking System Tables
-- Date: 2024-12-05
-- Author: Supply Chain Hub Team
-- Description: Adds multi-modal tracking support (maritime, air, parcel)
-- Status: EXECUTED SUCCESSFULLY

-- ============================================
-- 1. MAIN TRACKING TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS trackings (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    organizzazione_id UUID REFERENCES organizzazioni(id) ON DELETE CASCADE,
    
    -- Tracking identifiers
    tracking_number VARCHAR(100) NOT NULL,
    tracking_type VARCHAR(20) NOT NULL CHECK (tracking_type IN ('container', 'bl', 'awb', 'parcel')),
    reference_number VARCHAR(100),
    
    -- Carrier info
    carrier_code VARCHAR(10),
    carrier_name VARCHAR(100),
    service_type VARCHAR(50),
    
    -- Route info
    origin_port VARCHAR(10),
    origin_name VARCHAR(100),
    destination_port VARCHAR(10),
    destination_name VARCHAR(100),
    
    -- Current status
    status VARCHAR(50) DEFAULT 'registered',
    status_details TEXT,
    eta TIMESTAMP,
    ata TIMESTAMP,
    
    -- Last event cache
    last_event_date TIMESTAMP,
    last_event_location VARCHAR(200),
    last_event_description TEXT,
    
    -- Transport info
    vessel_name VARCHAR(100),
    vessel_imo VARCHAR(20),
    voyage_number VARCHAR(50),
    flight_number VARCHAR(20),
    
    -- Additional data
    metadata JSONB DEFAULT '{}',
    active BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_tracking_per_org UNIQUE(organizzazione_id, tracking_number, tracking_type)
);

-- ============================================
-- 2. TRACKING EVENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS tracking_events (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    tracking_id UUID REFERENCES trackings(id) ON DELETE CASCADE,
    
    -- Event info
    event_date TIMESTAMP WITH TIME ZONE NOT NULL,
    event_type VARCHAR(50),
    event_code VARCHAR(50),
    
    -- Location
    location_name VARCHAR(200),
    location_code VARCHAR(10),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    -- Description
    description TEXT,
    description_local TEXT,
    
    -- Transport info
    vessel_imo VARCHAR(20),
    vessel_name VARCHAR(100),
    voyage_number VARCHAR(50),
    
    -- Data source
    data_source VARCHAR(50) DEFAULT 'shipsgo',
    confidence_score DECIMAL(3,2) DEFAULT 1.00,
    raw_data JSONB,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 3. INDEXES
-- ============================================
CREATE INDEX idx_trackings_org_status ON trackings(organizzazione_id, status);
CREATE INDEX idx_trackings_number ON trackings(tracking_number);
CREATE INDEX idx_trackings_type ON trackings(tracking_type);
CREATE INDEX idx_trackings_updated ON trackings(updated_at DESC);

CREATE INDEX idx_tracking_events_tracking_date ON tracking_events(tracking_id, event_date DESC);
CREATE INDEX idx_tracking_events_date ON tracking_events(event_date DESC);

-- ============================================
-- 4. TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_trackings_updated_at BEFORE UPDATE
    ON trackings FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- ============================================
-- 5. ROW LEVEL SECURITY
-- ============================================
ALTER TABLE trackings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_events ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 6. PERMISSIONS
-- ============================================
GRANT ALL ON trackings TO authenticated;
GRANT ALL ON tracking_events TO authenticated;

-- ============================================
-- 7. RLS POLICIES
-- ============================================
-- Note: Uses profiles.organizzazione_id for multi-tenant isolation

-- Policies for trackings
CREATE POLICY "trackings_select_policy" ON trackings
    FOR SELECT
    USING (
        organizzazione_id IN (
            SELECT organizzazione_id 
            FROM profiles 
            WHERE id = auth.uid()
        )
    );

CREATE POLICY "trackings_insert_policy" ON trackings
    FOR INSERT
    WITH CHECK (
        organizzazione_id IN (
            SELECT organizzazione_id 
            FROM profiles 
            WHERE id = auth.uid()
        )
    );

CREATE POLICY "trackings_update_policy" ON trackings
    FOR UPDATE
    USING (
        organizzazione_id IN (
            SELECT organizzazione_id 
            FROM profiles 
            WHERE id = auth.uid()
        )
    );

CREATE POLICY "trackings_delete_policy" ON trackings
    FOR DELETE
    USING (
        organizzazione_id IN (
            SELECT organizzazione_id 
            FROM profiles 
            WHERE id = auth.uid()
        )
    );

-- Policies for tracking_events
CREATE POLICY "tracking_events_select_policy" ON tracking_events
    FOR SELECT
    USING (
        tracking_id IN (
            SELECT id FROM trackings 
            WHERE organizzazione_id IN (
                SELECT organizzazione_id 
                FROM profiles 
                WHERE id = auth.uid()
            )
        )
    );

CREATE POLICY "tracking_events_insert_policy" ON tracking_events
    FOR INSERT
    WITH CHECK (
        tracking_id IN (
            SELECT id FROM trackings 
            WHERE organizzazione_id IN (
                SELECT organizzazione_id 
                FROM profiles 
                WHERE id = auth.uid()
            )
        )
    );

CREATE POLICY "tracking_events_update_policy" ON tracking_events
    FOR UPDATE
    USING (
        tracking_id IN (
            SELECT id FROM trackings 
            WHERE organizzazione_id IN (
                SELECT organizzazione_id 
                FROM profiles 
                WHERE id = auth.uid()
            )
        )
    );

CREATE POLICY "tracking_events_delete_policy" ON tracking_events
    FOR DELETE
    USING (
        tracking_id IN (
            SELECT id FROM trackings 
            WHERE organizzazione_id IN (
                SELECT organizzazione_id 
                FROM profiles 
                WHERE id = auth.uid()
            )
        )
    );