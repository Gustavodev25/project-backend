-- Add latitude/longitude to meli_venda for shipment geolocation
ALTER TABLE "meli_venda"
  ADD COLUMN IF NOT EXISTS "latitude" DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS "longitude" DECIMAL(10,7);

