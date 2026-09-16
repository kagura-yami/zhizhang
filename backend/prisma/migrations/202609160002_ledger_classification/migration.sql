CREATE TABLE "public"."bill_financial_classifications" (
  "bill_id" INTEGER NOT NULL,
  "kind" VARCHAR(30) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'CNY',
  "bill_updated_at" TIMESTAMPTZ(6) NOT NULL,
  "reviewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bill_financial_classifications_pkey" PRIMARY KEY ("bill_id"),
  CONSTRAINT "bill_financial_classifications_kind_check" CHECK ("kind" IN ('ordinary', 'refund', 'internal_transfer', 'adjustment', 'ignored')),
  CONSTRAINT "bill_financial_classifications_currency_check" CHECK ("currency" = 'CNY'),
  CONSTRAINT "bill_financial_classifications_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
