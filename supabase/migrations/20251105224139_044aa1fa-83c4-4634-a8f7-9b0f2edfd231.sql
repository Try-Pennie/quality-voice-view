-- Enable RLS on eavesly_calls if not already enabled
ALTER TABLE public.eavesly_calls ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all call data
CREATE POLICY "Enable read access for authenticated users"
ON public.eavesly_calls
FOR SELECT
TO authenticated
USING (true);

-- Allow public read access (since managers need to view all agent calls)
CREATE POLICY "Enable read access for all users"
ON public.eavesly_calls
FOR SELECT
TO public
USING (true);