-- Creazione tabella organizzazioni
CREATE TABLE public.organizzazioni (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    nome_azienda text NOT NULL,
    logo_url text NULL,
    sfondo_url text NULL,
    created_at timestamptz NULL DEFAULT now(),
    CONSTRAINT organizzazioni_pkey PRIMARY KEY (id)
);