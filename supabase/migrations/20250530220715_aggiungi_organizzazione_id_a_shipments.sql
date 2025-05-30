-- Aggiunta colonna organizzazione_id a shipments
ALTER TABLE public.shipments
ADD COLUMN organizzazione_id uuid NULL;

-- Aggiunta della foreign key (considera ON DELETE CASCADE o SET NULL a seconda della logica desiderata)
ALTER TABLE public.shipments
ADD CONSTRAINT shipments_organizzazione_id_fkey FOREIGN KEY (organizzazione_id)
REFERENCES public.organizzazioni(id) ON DELETE SET NULL;